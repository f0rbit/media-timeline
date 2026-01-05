import type { Backend } from "@f0rbit/corpus";
import { BlueskyRawSchema, type CommitGroup, DevpadRawSchema, type Platform, type TimelineItem, YouTubeRawSchema, accounts, profiles, rateLimits } from "@media/schema";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../db";
import type { CronProcessError } from "../errors";
import type { AppContext } from "../infrastructure";
import { createLogger } from "../logger";
import {
	type AccountWithUser,
	type CronProcessor,
	GitHubProvider,
	type ProviderError,
	type ProviderFactory,
	getCronProcessor,
	getPlatformCapabilities,
	getPlatformsWithMultiStore,
	normalizeBluesky,
	normalizeDevpad,
	normalizeYouTube,
	registerCronProcessor,
} from "../platforms";
import { RedditProvider } from "../platforms/reddit";
import { TwitterProvider } from "../platforms/twitter";
import { type RateLimitState, type RawData, createRawStore, createTimelineStore, rawStoreId, shouldFetch } from "../storage";
import { groupByDate, groupCommits, loadGitHubDataForAccount, loadRedditDataForAccount, loadTwitterDataForAccount, normalizeGitHub, normalizeReddit, normalizeTwitter } from "../timeline/index";
import { type Result, decrypt, pipe, to_nullable, try_catch, uuid } from "../utils";
import { processGitHubAccount } from "./processors/github";
import { processRedditAccount } from "./processors/reddit";
import { processTwitterAccount } from "./processors/twitter";
import type { CronResult, NormalizeError, PlatformGroups, PlatformProcessResult, ProcessingError, RateLimitRow, RawSnapshot } from "./types";

export { type ProcessResult, type StoreStats, type MergeResult, type StoreConfig, type ProcessError, type PlatformProvider, defaultStats, storeWithMerge, storeMeta, createMerger, formatFetchError } from "./platform-processor";
export { processGitHubAccount, type GitHubProcessResult } from "./processors/github";
export { processRedditAccount, type RedditProcessResult } from "./processors/reddit";
export { processTwitterAccount, type TwitterProcessResult } from "./processors/twitter";
export type { CronResult, RawSnapshot, PlatformGroups } from "./types";
export type { ProviderFactory };

const log = createLogger("cron");

type TimelineEntry = TimelineItem | CommitGroup;

const parseDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

const shouldFetchForPlatform = (platform: Platform, lastFetchedAt: string | null): boolean => {
	const capabilities = getPlatformCapabilities(platform);
	if (!capabilities.fetchIntervalDays) return true;
	if (!lastFetchedAt) return true;
	const lastFetch = new Date(lastFetchedAt);
	const now = new Date();
	const daysSinceLastFetch = (now.getTime() - lastFetch.getTime()) / (1000 * 60 * 60 * 24);
	return daysSinceLastFetch >= capabilities.fetchIntervalDays;
};

const toRateLimitState = (row: RateLimitRow | null): RateLimitState => ({
	remaining: row?.remaining ?? null,
	limit_total: null,
	reset_at: parseDate(row?.reset_at ?? null),
	consecutive_failures: row?.consecutive_failures ?? 0,
	last_failure_at: null,
	circuit_open_until: parseDate(row?.circuit_open_until ?? null),
});

registerCronProcessor("github", {
	shouldFetch: () => true,
	createProvider: (ctx: AppContext) => ctx.gitHubProvider ?? new GitHubProvider(),
	processAccount: processGitHubAccount as CronProcessor["processAccount"],
});

registerCronProcessor("reddit", {
	shouldFetch: () => true,
	createProvider: () => new RedditProvider(),
	processAccount: (backend, accountId, token, provider, account) => processRedditAccount(backend, accountId, token, provider as RedditProvider, account),
});

registerCronProcessor("twitter", {
	shouldFetch: (_account, lastFetched) => shouldFetchForPlatform("twitter", lastFetched),
	createProvider: (ctx: AppContext) => ctx.twitterProvider ?? new TwitterProvider(),
	processAccount: processTwitterAccount as CronProcessor["processAccount"],
});

const fetchActiveAccounts = async (db: Database) =>
	db
		.select({
			id: accounts.id,
			profile_id: accounts.profile_id,
			platform: accounts.platform,
			platform_user_id: accounts.platform_user_id,
			access_token_encrypted: accounts.access_token_encrypted,
			refresh_token_encrypted: accounts.refresh_token_encrypted,
			user_id: profiles.user_id,
			last_fetched_at: accounts.last_fetched_at,
		})
		.from(accounts)
		.innerJoin(profiles, eq(accounts.profile_id, profiles.id))
		.where(eq(accounts.is_active, true));

const groupAccountsByUser = (accountsWithUsers: AccountWithUser[]): Map<string, AccountWithUser[]> => {
	const userAccounts = new Map<string, AccountWithUser[]>();
	for (const account of accountsWithUsers) {
		const existing = userAccounts.get(account.user_id) ?? [];
		existing.push(account);
		userAccounts.set(account.user_id, existing);
	}
	return userAccounts;
};

const processAccountBatch = async (ctx: AppContext, userAccountsList: AccountWithUser[], result: CronResult): Promise<boolean> => {
	const results = await Promise.allSettled(
		userAccountsList.map(async account => {
			result.processed_accounts++;
			const snapshot = await processAccount(ctx, account);
			return snapshot !== null;
		})
	);

	let hasUpdates = false;
	for (const res of results) {
		if (res.status === "rejected") {
			log.error("Account processing failed", { reason: String(res.reason) });
		} else if (res.value) {
			hasUpdates = true;
		}
	}

	return hasUpdates;
};

const regenerateTimelinesForUsers = async (backend: Backend, updatedUsers: Set<string>, userAccounts: Map<string, AccountWithUser[]>): Promise<number> => {
	let timelinesGenerated = 0;
	for (const userId of updatedUsers) {
		const userAccountsList = userAccounts.get(userId) ?? [];
		const snapshots = await gatherLatestSnapshots(backend, userAccountsList);
		await combineUserTimeline(backend, userId, snapshots);
		timelinesGenerated++;
	}
	return timelinesGenerated;
};

export async function handleCron(ctx: AppContext): Promise<CronResult> {
	log.info("Cron job starting");

	const result: CronResult = {
		processed_accounts: 0,
		updated_users: [],
		failed_accounts: [],
		timelines_generated: 0,
	};

	const accountsWithUsers = await fetchActiveAccounts(ctx.db);
	const userAccounts = groupAccountsByUser(accountsWithUsers);

	log.info("Processing accounts", { total: accountsWithUsers.length, users: userAccounts.size });

	const updatedUsers = new Set<string>();

	for (const [userId, userAccountsList] of userAccounts) {
		const hasUpdates = await processAccountBatch(ctx, userAccountsList, result);
		if (hasUpdates) {
			updatedUsers.add(userId);
		}
	}

	result.timelines_generated = await regenerateTimelinesForUsers(ctx.backend, updatedUsers, userAccounts);
	result.updated_users = Array.from(updatedUsers);

	log.info("Cron job completed", {
		processed: result.processed_accounts,
		timelines: result.timelines_generated,
		updated_users: result.updated_users.length,
		failed: result.failed_accounts.length,
	});

	return result;
}

const formatProviderError = (e: ProviderError): string => {
	switch (e.kind) {
		case "api_error":
			return `API error ${e.status}: ${e.message}`;
		case "bad_request":
			return `Bad request: ${e.message}`;
		case "network_error":
			return e.cause?.message ?? "Network error";
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
			id: uuid(),
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
			id: uuid(),
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
				log.error("Decryption failed", { account_id: accountId, message: e.message });
				break;
			case "fetch_failed":
				log.error("Fetch failed", { account_id: accountId, message: e.message });
				break;
			case "store_failed":
				log.error("Store creation failed", { account_id: accountId, store_id: e.store_id });
				break;
			case "put_failed":
				log.error("Store put failed", { account_id: accountId, message: e.message });
				break;
		}
	};

const toProcessError = (e: ProviderError): CronProcessError => ({
	kind: "fetch_failed",
	message: formatProviderError(e),
	status: e.kind === "api_error" ? e.status : undefined,
});

const processPlatformAccountWithProcessor = async (ctx: AppContext, account: AccountWithUser, processor: CronProcessor, platform: Platform): Promise<RawSnapshot | null> => {
	return pipe(decrypt(account.access_token_encrypted, ctx.encryptionKey))
		.map_err((e): ProcessingError => ({ kind: e.kind, message: e.message }))
		.tap_err(() => log.error("Decryption failed", { platform, account_id: account.id }))
		.flat_map(async (token): Promise<Result<PlatformProcessResult, ProcessingError>> => {
			const provider = processor.createProvider(ctx);
			return processor.processAccount(ctx.backend, account.id, token, provider, account);
		})
		.tap_err(e => {
			log.error("Processing failed", { platform, account_id: account.id, error: e });
			recordFailure(ctx.db, account.id);
		})
		.tap(() => recordSuccess(ctx.db, account.id))
		.map(
			(result): RawSnapshot => ({
				account_id: account.id,
				platform,
				version: result.meta_version,
				data: {
					type: `${platform}_multi_store`,
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
				.map_err((e): CronProcessError => ({ kind: "store_failed", store_id: e.message ?? "unknown" }))
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

export const processAccount = async (ctx: AppContext, account: AccountWithUser): Promise<RawSnapshot | null> => {
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

	const platform = account.platform as Platform;
	const processor = getCronProcessor(platform);

	if (!processor) {
		return processGenericAccount(ctx, account);
	}

	if (!processor.shouldFetch(account, account.last_fetched_at ?? null)) {
		return null;
	}

	return processPlatformAccountWithProcessor(ctx, account, processor, platform);
};

const getLatestSnapshot = async (backend: Backend, account: AccountWithUser): Promise<RawSnapshot | null> => {
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

export const gatherLatestSnapshots = async (backend: Backend, accounts: AccountWithUser[]): Promise<RawSnapshot[]> => {
	const results = await Promise.all(accounts.map(account => getLatestSnapshot(backend, account)));
	return results.filter((s): s is RawSnapshot => s !== null);
};

const isMultiStore = (platform: string): boolean => {
	const multiStorePlatforms = getPlatformsWithMultiStore();
	return multiStorePlatforms.includes(platform as Platform);
};

export const groupSnapshotsByPlatform = (snapshots: RawSnapshot[]): PlatformGroups => ({
	github: snapshots.filter(s => s.platform === "github"),
	reddit: snapshots.filter(s => s.platform === "reddit"),
	twitter: snapshots.filter(s => s.platform === "twitter"),
	other: snapshots.filter(s => !isMultiStore(s.platform)),
});

export const loadPlatformItems = async <T>(backend: Backend, snapshots: RawSnapshot[], loader: (backend: Backend, accountId: string) => Promise<T>, normalizer: (data: T) => TimelineItem[]): Promise<TimelineItem[]> => {
	const items: TimelineItem[] = [];
	for (const snapshot of snapshots) {
		const data = await loader(backend, snapshot.account_id);
		items.push(...normalizer(data));
	}
	return items;
};

export const normalizeOtherSnapshots = (snapshots: RawSnapshot[]): TimelineItem[] => {
	const results = snapshots.map(snapshot => normalizeSnapshot(snapshot));

	for (const r of results) {
		if (!r.ok) {
			log.error("Normalization failed", { platform: r.error.platform, message: r.error.message });
		}
	}

	return results.filter((r): r is { ok: true; value: TimelineItem[] } => r.ok).flatMap(r => r.value);
};

export const generateTimeline = (userId: string, items: TimelineItem[]) => {
	log.debug("Generating timeline", { user_id: userId, item_count: items.length });

	const entries: TimelineEntry[] = groupCommits(items);
	const dateGroups = groupByDate(entries);

	log.debug("Timeline generated", { user_id: userId, entries: entries.length, date_groups: dateGroups.length });

	return {
		user_id: userId,
		generated_at: new Date().toISOString(),
		groups: dateGroups,
	};
};

export const storeTimeline = async (backend: Backend, userId: string, timeline: ReturnType<typeof generateTimeline>, snapshots: RawSnapshot[]): Promise<void> => {
	const parents = snapshots.map(s => ({
		store_id: rawStoreId(s.platform, s.account_id),
		version: s.version,
		role: "source" as const,
	}));

	await pipe(createTimelineStore(backend, userId))
		.tap_err(() => log.error("Timeline store creation failed", { user_id: userId }))
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

export const combineUserTimeline = async (backend: Backend, userId: string, snapshots: RawSnapshot[]): Promise<void> => {
	log.info("Building timeline", { user_id: userId, snapshot_count: snapshots.length });

	if (snapshots.length === 0) {
		await storeEmptyTimeline(backend, userId);
		return;
	}

	const byPlatform = groupSnapshotsByPlatform(snapshots);

	log.debug("Snapshots by platform", {
		github: byPlatform.github.length,
		reddit: byPlatform.reddit.length,
		twitter: byPlatform.twitter.length,
		other: byPlatform.other.length,
	});

	const [githubItems, redditItems, twitterItems] = await Promise.all([
		loadPlatformItems(backend, byPlatform.github, loadGitHubDataForAccount, normalizeGitHub),
		loadPlatformItems(backend, byPlatform.reddit, loadRedditDataForAccount, data => normalizeReddit(data, "")),
		loadPlatformItems(backend, byPlatform.twitter, loadTwitterDataForAccount, normalizeTwitter),
	]);

	const otherItems = normalizeOtherSnapshots(byPlatform.other);
	const allItems = [...githubItems, ...redditItems, ...twitterItems, ...otherItems];

	log.info("Timeline items loaded", {
		github: githubItems.length,
		reddit: redditItems.length,
		twitter: twitterItems.length,
		other: otherItems.length,
		total: allItems.length,
	});

	const timeline = generateTimeline(userId, allItems);
	await storeTimeline(backend, userId, timeline, snapshots);

	log.info("Timeline stored", {
		user_id: userId,
		date_groups: timeline.groups.length,
		generated_at: timeline.generated_at,
	});
};

const normalizeSnapshot = (snapshot: RawSnapshot): Result<TimelineItem[], NormalizeError> => {
	return try_catch(
		() => {
			const platform = snapshot.platform as Platform;
			switch (platform) {
				case "github":
				case "reddit":
				case "twitter":
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
				default: {
					const _exhaustiveCheck: never = platform;
					log.warn("Unknown platform in normalizeSnapshot", { platform: snapshot.platform });
					return [];
				}
			}
		},
		(e): NormalizeError => ({ kind: "parse_error", platform: snapshot.platform, message: String(e) })
	);
};
