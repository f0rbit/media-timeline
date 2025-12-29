import type { Backend } from "@f0rbit/corpus";
import { eq, sql } from "drizzle-orm";
import { processGitHubAccount } from "./cron-github";
import { processRedditAccount } from "./cron-reddit";
import { processTwitterAccount } from "./cron-twitter";
import type { Database } from "./db";
import type { CronProcessError } from "./errors";
import type { AppContext } from "./infrastructure";
import { GitHubProvider, type ProviderError, type ProviderFactory, normalizeBluesky, normalizeDevpad, normalizeYouTube } from "./platforms";
import { RedditProvider } from "./platforms/reddit";
import { TwitterProvider } from "./platforms/twitter";
import { BlueskyRawSchema, type CommitGroup, DevpadRawSchema, type Platform, type TimelineItem, YouTubeRawSchema, accountMembers, accounts, rateLimits } from "./schema";
import { type RateLimitState, type RawData, createRawStore, createTimelineStore, rawStoreId, shouldFetch } from "./storage";
import { groupByDate, groupCommits } from "./timeline";
import { loadGitHubDataForAccount, normalizeGitHub } from "./timeline-github";
import { loadRedditDataForAccount, normalizeReddit } from "./timeline-reddit";
import { loadTwitterDataForAccount, normalizeTwitter } from "./timeline-twitter";
import { type Result, decrypt, pipe, to_nullable, try_catch } from "./utils";

export { processAccount, gatherLatestSnapshots, combineUserTimeline, groupSnapshotsByPlatform, loadPlatformItems, normalizeOtherSnapshots, generateTimeline, storeTimeline, platformProcessors };
export type { ProviderFactory, RawSnapshot, PlatformGroups, PlatformProcessor };

type RawSnapshot = {
	account_id: string;
	platform: string;
	version: string;
	data: unknown;
};

type AccountWithUser = {
	id: string;
	platform: string;
	platform_user_id: string | null;
	access_token_encrypted: string;
	refresh_token_encrypted: string | null;
	user_id: string;
	last_fetched_at?: string | null;
};

type RateLimitRow = {
	remaining: number | null;
	reset_at: string | null;
	consecutive_failures: number | null;
	circuit_open_until: string | null;
};

export type CronResult = {
	processed_accounts: number;
	updated_users: string[];
	failed_accounts: string[];
	timelines_generated: number;
};

type NormalizeError = { kind: "parse_error"; platform: string; message: string };

type TimelineEntry = TimelineItem | CommitGroup;

const parseDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

// Twitter has a 100 posts/month cap on Free tier, so we only fetch every 3 days
const TWITTER_FETCH_INTERVAL_DAYS = 3;

const shouldFetchTwitter = (lastFetchedAt: string | null): boolean => {
	if (!lastFetchedAt) return true;
	const lastFetch = new Date(lastFetchedAt);
	const now = new Date();
	const daysSinceLastFetch = (now.getTime() - lastFetch.getTime()) / (1000 * 60 * 60 * 24);
	return daysSinceLastFetch >= TWITTER_FETCH_INTERVAL_DAYS;
};

const toRateLimitState = (row: RateLimitRow | null): RateLimitState => ({
	remaining: row?.remaining ?? null,
	limit_total: null,
	reset_at: parseDate(row?.reset_at ?? null),
	consecutive_failures: row?.consecutive_failures ?? 0,
	last_failure_at: null,
	circuit_open_until: parseDate(row?.circuit_open_until ?? null),
});

export async function handleCron(ctx: AppContext): Promise<CronResult> {
	const result: CronResult = {
		processed_accounts: 0,
		updated_users: [],
		failed_accounts: [],
		timelines_generated: 0,
	};

	const accountsWithUsers = await ctx.db
		.select({
			id: accounts.id,
			platform: accounts.platform,
			platform_user_id: accounts.platform_user_id,
			access_token_encrypted: accounts.access_token_encrypted,
			refresh_token_encrypted: accounts.refresh_token_encrypted,
			user_id: accountMembers.user_id,
			last_fetched_at: accounts.last_fetched_at,
		})
		.from(accounts)
		.innerJoin(accountMembers, eq(accounts.id, accountMembers.account_id))
		.where(eq(accounts.is_active, true));

	const userAccounts = new Map<string, AccountWithUser[]>();
	for (const account of accountsWithUsers) {
		const existing = userAccounts.get(account.user_id) ?? [];
		existing.push(account);
		userAccounts.set(account.user_id, existing);
	}

	const updatedUsers = new Set<string>();

	for (const [userId, userAccountsList] of userAccounts) {
		const results = await Promise.allSettled(
			userAccountsList.map(async account => {
				result.processed_accounts++;
				const snapshot = await processAccount(ctx, account);
				if (snapshot) {
					updatedUsers.add(userId);
					return snapshot;
				}
				return null;
			})
		);

		for (const res of results) {
			if (res.status === "rejected") {
				console.error("Account processing failed:", res.reason);
			}
		}
	}

	for (const userId of updatedUsers) {
		const userAccountsList = userAccounts.get(userId) ?? [];
		const snapshots = await gatherLatestSnapshots(ctx.backend, userAccountsList);
		await combineUserTimeline(ctx.backend, userId, snapshots);
		result.timelines_generated++;
	}

	result.updated_users = Array.from(updatedUsers);
	return result;
}

const formatProviderError = (e: ProviderError): string => {
	switch (e.kind) {
		case "api_error":
			return `API error ${e.status}: ${e.message}`;
		case "unknown_platform":
			return `Unknown platform: ${e.platform}`;
		case "network_error":
			return e.cause.message;
		case "rate_limited":
			return `Rate limited, retry after ${e.retry_after}s`;
		case "auth_expired":
			return `Auth expired: ${e.message}`;
		case "parse_error":
			return `Parse error: ${e.message}`;
	}
};

const recordFailure = async (db: Database, accountId: string): Promise<void> => {
	const now = new Date().toISOString();
	await db
		.insert(rateLimits)
		.values({
			id: crypto.randomUUID(),
			account_id: accountId,
			consecutive_failures: 1,
			last_failure_at: now,
			updated_at: now,
		})
		.onConflictDoUpdate({
			target: rateLimits.account_id,
			set: {
				consecutive_failures: sql`${rateLimits.consecutive_failures} + 1`,
				last_failure_at: now,
				updated_at: now,
			},
		});
};

const recordSuccess = async (db: Database, accountId: string): Promise<void> => {
	const now = new Date().toISOString();
	await db
		.insert(rateLimits)
		.values({
			id: crypto.randomUUID(),
			account_id: accountId,
			consecutive_failures: 0,
			updated_at: now,
		})
		.onConflictDoUpdate({
			target: rateLimits.account_id,
			set: {
				consecutive_failures: 0,
				updated_at: now,
			},
		});
	await db.update(accounts).set({ last_fetched_at: now, updated_at: now }).where(eq(accounts.id, accountId));
};

const logProcessError =
	(accountId: string): ((e: CronProcessError) => void) =>
	(e: CronProcessError): void => {
		switch (e.kind) {
			case "decryption_failed":
				console.error(`Decryption failed for account ${accountId}: ${e.message}`);
				break;
			case "fetch_failed":
				console.error(`Fetch failed for account ${accountId}: ${e.message}`);
				break;
			case "store_failed":
				console.error(`Failed to create store for account ${accountId}: ${e.store_id}`);
				break;
			case "put_failed":
				console.error(`Failed to store raw data: ${e.message}`);
				break;
		}
	};

const toProcessError = (e: ProviderError): CronProcessError => ({
	kind: "fetch_failed",
	message: formatProviderError(e),
	status: e.kind === "api_error" ? e.status : undefined,
});

type PlatformProcessResult = {
	meta_version: string;
	stats: Record<string, unknown>;
};

type PlatformProcessor = {
	platform: Platform;
	shouldFetch: (account: AccountWithUser, lastFetchedAt: string | null) => boolean;
	createProvider: (ctx: AppContext) => unknown;
	processAccount: (backend: Backend, accountId: string, token: string, provider: unknown) => Promise<Result<PlatformProcessResult, { kind: string; message?: string }>>;
};

const platformProcessors = new Map<Platform, PlatformProcessor>([
	[
		"github",
		{
			platform: "github" as const,
			shouldFetch: () => true,
			createProvider: (ctx: AppContext) => ctx.gitHubProvider ?? new GitHubProvider(),
			processAccount: processGitHubAccount as PlatformProcessor["processAccount"],
		},
	],
	[
		"reddit",
		{
			platform: "reddit" as const,
			shouldFetch: () => true,
			createProvider: () => new RedditProvider(),
			processAccount: processRedditAccount as PlatformProcessor["processAccount"],
		},
	],
	[
		"twitter",
		{
			platform: "twitter" as const,
			shouldFetch: (_account: AccountWithUser, lastFetched: string | null) => shouldFetchTwitter(lastFetched),
			createProvider: (ctx: AppContext) => ctx.twitterProvider ?? new TwitterProvider(),
			processAccount: processTwitterAccount as PlatformProcessor["processAccount"],
		},
	],
]);

type ProcessingError = { kind: string; message?: string };

const processPlatformAccountWithProcessor = async (ctx: AppContext, account: AccountWithUser, processor: PlatformProcessor): Promise<RawSnapshot | null> => {
	return pipe(decrypt(account.access_token_encrypted, ctx.encryptionKey))
		.map_err((e): ProcessingError => ({ kind: e.kind, message: e.message }))
		.tap_err(() => console.error(`[cron] ${processor.platform} decryption failed for account:`, account.id))
		.flat_map(async (token): Promise<Result<PlatformProcessResult, ProcessingError>> => {
			const provider = processor.createProvider(ctx);
			return processor.processAccount(ctx.backend, account.id, token, provider);
		})
		.tap_err(e => {
			console.error(`[cron] ${processor.platform} processing failed:`, account.id, e);
			recordFailure(ctx.db, account.id);
		})
		.tap(() => recordSuccess(ctx.db, account.id))
		.map(
			(result): RawSnapshot => ({
				account_id: account.id,
				platform: processor.platform,
				version: result.meta_version,
				data: {
					type: `${processor.platform}_multi_store`,
					...result.stats,
				},
			})
		)
		.unwrap_or(null as unknown as RawSnapshot)
		.then(r => r as RawSnapshot | null);
};

const processGenericAccount = async (ctx: AppContext, account: AccountWithUser): Promise<RawSnapshot | null> => {
	return pipe(decrypt(account.access_token_encrypted, ctx.encryptionKey))
		.map_err((e): CronProcessError => ({ kind: "decryption_failed", message: e.message }))
		.flat_map(token => {
			const result = ctx.providerFactory.create(account.platform, account.platform_user_id, token);
			return pipe(result)
				.map_err(e => toProcessError(e))
				.tap_err(() => recordFailure(ctx.db, account.id))
				.result();
		})
		.flat_map(raw_data => {
			return pipe(createRawStore(ctx.backend, account.platform, account.id))
				.map_err((e): CronProcessError => ({ kind: "store_failed", store_id: e.store_id }))
				.map(({ store }) => ({ raw_data, store }))
				.result();
		})
		.flat_map(({ raw_data, store }) => {
			return pipe(store.put(raw_data as RawData, { tags: [`platform:${account.platform}`, `account:${account.id}`] }))
				.map_err((e): CronProcessError => ({ kind: "put_failed", message: String(e) }))
				.map((result: { version: string }) => ({ raw_data, version: result.version }))
				.result();
		})
		.tap_err(logProcessError(account.id))
		.tap(() => recordSuccess(ctx.db, account.id))
		.map(
			(result: { raw_data: Record<string, unknown>; version: string }): RawSnapshot => ({
				account_id: account.id,
				platform: account.platform,
				version: result.version,
				data: result.raw_data,
			})
		)
		.unwrap_or(null as unknown as RawSnapshot)
		.then(r => r as RawSnapshot | null);
};

const processAccount = async (ctx: AppContext, account: AccountWithUser): Promise<RawSnapshot | null> => {
	const rateLimitRow = await ctx.db
		.select({
			remaining: rateLimits.remaining,
			reset_at: rateLimits.reset_at,
			consecutive_failures: rateLimits.consecutive_failures,
			circuit_open_until: rateLimits.circuit_open_until,
		})
		.from(rateLimits)
		.where(eq(rateLimits.account_id, account.id))
		.get();

	if (!shouldFetch(toRateLimitState(rateLimitRow ?? null))) {
		return null;
	}

	const processor = platformProcessors.get(account.platform as Platform);

	if (!processor) {
		return processGenericAccount(ctx, account);
	}

	if (!processor.shouldFetch(account, account.last_fetched_at ?? null)) {
		return null;
	}

	return processPlatformAccountWithProcessor(ctx, account, processor);
};

const getLatestSnapshot = async (backend: Backend, account: AccountWithUser): Promise<RawSnapshot | null> => {
	// GitHub uses multi-store format
	if (account.platform === "github") {
		const githubData = await loadGitHubDataForAccount(backend, account.id);
		if (githubData.commits.length === 0 && githubData.prs.length === 0) {
			return null;
		}
		return {
			account_id: account.id,
			platform: "github",
			version: new Date().toISOString(),
			data: { type: "github_multi_store" },
		};
	}

	// Reddit uses multi-store format
	if (account.platform === "reddit") {
		const redditData = await loadRedditDataForAccount(backend, account.id);
		if (redditData.posts.length === 0 && redditData.comments.length === 0) {
			return null;
		}
		return {
			account_id: account.id,
			platform: "reddit",
			version: new Date().toISOString(),
			data: { type: "reddit_multi_store" },
		};
	}

	// Twitter uses multi-store format
	if (account.platform === "twitter") {
		const twitterData = await loadTwitterDataForAccount(backend, account.id);
		if (twitterData.tweets.length === 0) {
			return null;
		}
		return {
			account_id: account.id,
			platform: "twitter",
			version: new Date().toISOString(),
			data: { type: "twitter_multi_store" },
		};
	}

	const storeResult = createRawStore(backend, account.platform, account.id);
	if (!storeResult.ok) {
		return null;
	}

	const snapshot = to_nullable(await storeResult.value.store.get_latest());
	if (!snapshot) {
		return null;
	}

	return {
		account_id: account.id,
		platform: account.platform,
		version: snapshot.meta.version,
		data: snapshot.data,
	};
};

const gatherLatestSnapshots = async (backend: Backend, accounts: AccountWithUser[]): Promise<RawSnapshot[]> => {
	const results = await Promise.all(accounts.map(account => getLatestSnapshot(backend, account)));
	return results.filter((s): s is RawSnapshot => s !== null);
};

const MULTI_STORE_PLATFORMS = ["github", "reddit", "twitter"] as const;

type PlatformGroups = {
	github: RawSnapshot[];
	reddit: RawSnapshot[];
	twitter: RawSnapshot[];
	other: RawSnapshot[];
};

const groupSnapshotsByPlatform = (snapshots: RawSnapshot[]): PlatformGroups => ({
	github: snapshots.filter(s => s.platform === "github"),
	reddit: snapshots.filter(s => s.platform === "reddit"),
	twitter: snapshots.filter(s => s.platform === "twitter"),
	other: snapshots.filter(s => !MULTI_STORE_PLATFORMS.includes(s.platform as (typeof MULTI_STORE_PLATFORMS)[number])),
});

const loadPlatformItems = async <T>(backend: Backend, snapshots: RawSnapshot[], loader: (backend: Backend, accountId: string) => Promise<T>, normalizer: (data: T) => TimelineItem[]): Promise<TimelineItem[]> => {
	const items: TimelineItem[] = [];
	for (const snapshot of snapshots) {
		const data = await loader(backend, snapshot.account_id);
		items.push(...normalizer(data));
	}
	return items;
};

const normalizeOtherSnapshots = (snapshots: RawSnapshot[]): TimelineItem[] => {
	const results = snapshots.map(snapshot => normalizeSnapshot(snapshot));

	for (const r of results) {
		if (!r.ok) {
			console.error(`[cron] Failed to normalize ${r.error.platform} data: ${r.error.message}`);
		}
	}

	return results.filter((r): r is { ok: true; value: TimelineItem[] } => r.ok).flatMap(r => r.value);
};

const generateTimeline = (userId: string, items: TimelineItem[]) => {
	const entries: TimelineEntry[] = groupCommits(items);
	const dateGroups = groupByDate(entries);

	return {
		user_id: userId,
		generated_at: new Date().toISOString(),
		groups: dateGroups,
	};
};

const storeTimeline = async (backend: Backend, userId: string, timeline: ReturnType<typeof generateTimeline>, snapshots: RawSnapshot[]): Promise<void> => {
	const parents = snapshots.map(s => ({
		store_id: rawStoreId(s.platform, s.account_id),
		version: s.version,
		role: "source" as const,
	}));

	await pipe(createTimelineStore(backend, userId))
		.tap_err(() => console.error(`[cron] Failed to create timeline store for user ${userId}`))
		.tap(async ({ store }) => {
			await store.put(timeline, { parents });
		})
		.result();
};

const storeEmptyTimeline = async (backend: Backend, userId: string): Promise<void> => {
	const emptyTimeline = {
		user_id: userId,
		generated_at: new Date().toISOString(),
		groups: [],
	};
	await pipe(createTimelineStore(backend, userId))
		.tap(async ({ store }) => {
			await store.put(emptyTimeline, { parents: [] });
		})
		.result();
};

const combineUserTimeline = async (backend: Backend, userId: string, snapshots: RawSnapshot[]): Promise<void> => {
	if (snapshots.length === 0) {
		await storeEmptyTimeline(backend, userId);
		return;
	}

	const byPlatform = groupSnapshotsByPlatform(snapshots);

	const [githubItems, redditItems, twitterItems] = await Promise.all([
		loadPlatformItems(backend, byPlatform.github, loadGitHubDataForAccount, normalizeGitHub),
		loadPlatformItems(backend, byPlatform.reddit, loadRedditDataForAccount, data => normalizeReddit(data, "")),
		loadPlatformItems(backend, byPlatform.twitter, loadTwitterDataForAccount, normalizeTwitter),
	]);

	const otherItems = normalizeOtherSnapshots(byPlatform.other);
	const allItems = [...githubItems, ...redditItems, ...twitterItems, ...otherItems];

	const timeline = generateTimeline(userId, allItems);
	await storeTimeline(backend, userId, timeline, snapshots);
};

const normalizeSnapshot = (snapshot: RawSnapshot): Result<TimelineItem[], NormalizeError> => {
	return try_catch(
		() => {
			switch (snapshot.platform as Platform) {
				case "github":
				case "reddit":
				case "twitter":
					// Handled separately via multi-store in combineUserTimeline
					return [];
				case "bluesky": {
					const blueskyParsed = BlueskyRawSchema.parse(snapshot.data);
					return normalizeBluesky(blueskyParsed);
				}
				case "youtube": {
					const youtubeParsed = YouTubeRawSchema.parse(snapshot.data);
					return normalizeYouTube(youtubeParsed);
				}
				case "devpad": {
					const devpadParsed = DevpadRawSchema.parse(snapshot.data);
					return normalizeDevpad(devpadParsed);
				}
				default:
					return [];
			}
		},
		(e): NormalizeError => ({ kind: "parse_error", platform: snapshot.platform, message: String(e) })
	);
};
