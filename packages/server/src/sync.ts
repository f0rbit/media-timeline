import type { Backend } from "@f0rbit/corpus";
import { BlueskyRawSchema, type CommitGroup, type CronError, DevpadRawSchema, type Platform, type TimelineItem, YouTubeRawSchema } from "@media/schema";
import { eq, sql } from "drizzle-orm";
import { accounts, rateLimits } from "@media/schema";
import type { Database } from "./db";
import type { AppContext } from "./infrastructure";
import { processGitHubAccount } from "./cron/processors/github";
import { processRedditAccount } from "./cron/processors/reddit";
import { processTwitterAccount } from "./cron/processors/twitter";
import { createLogger } from "./logger";
import { type CronProcessor, getPlatformCapabilities, getPlatformsWithMultiStore, GitHubProvider, normalizeBluesky, normalizeDevpad, normalizeYouTube } from "./platforms";
import { RedditProvider } from "./platforms/reddit";
import { TwitterProvider } from "./platforms/twitter";
import type { AccountWithUser } from "./platforms/registry";
import type { ProviderError, ProviderFactory } from "./platforms/types";
import { type RateLimitState, type RawData, createRawStore, createTimelineStore, rawStoreId, shouldFetch } from "./storage";
import { groupByDate, groupCommits, loadGitHubDataForAccount, loadRedditDataForAccount, loadTwitterDataForAccount, normalizeGitHub, normalizeReddit, normalizeTwitter } from "./timeline";
import { type Result, decrypt, pipe, to_nullable, try_catch, uuid } from "./utils";

// Re-export AccountWithUser for consumers
export type { AccountWithUser };

// ============================================================================
// Types
// ============================================================================

export type RawSnapshot = {
	account_id: string;
	platform: string;
	version: string;
	data: unknown;
};

export type NormalizeError = {
	kind: "parse_error";
	platform: string;
	message: string;
};

export type PlatformGroups = {
	github: RawSnapshot[];
	reddit: RawSnapshot[];
	twitter: RawSnapshot[];
	other: RawSnapshot[];
};

export type PlatformProcessResult = {
	meta_version: string;
	stats: Record<string, unknown>;
};

export type ProcessingError = {
	kind: string;
	message?: string;
};

// ============================================================================
// Account Processor
// ============================================================================

const logAccount = createLogger("sync:account");

type RateLimitRow = {
	remaining: number | null;
	reset_at: string | null;
	consecutive_failures: number | null;
	circuit_open_until: string | null;
};

const parseDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

export const shouldFetchForPlatform = (platform: Platform, lastFetchedAt: string | null): boolean => {
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

export const recordFailure = async (db: Database, accountId: string): Promise<void> => {
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

export const recordSuccess = async (db: Database, accountId: string): Promise<void> => {
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
	(accountId: string): ((e: CronError) => void) =>
	(e: CronError): void => {
		switch (e.kind) {
			case "encryption_error":
				logAccount.error("Encryption error", { account_id: accountId, operation: e.operation, message: e.message });
				break;
			case "network_error":
				logAccount.error("Network error", { account_id: accountId, message: e.message });
				break;
			case "store_error":
				logAccount.error("Store error", { account_id: accountId, operation: e.operation, message: e.message });
				break;
			case "auth_expired":
				logAccount.error("Auth expired", { account_id: accountId, message: e.message });
				break;
		}
	};

const toProcessError = (e: ProviderError): CronError => ({
	kind: "network_error",
	message: formatProviderError(e),
});

const processPlatformAccountWithProcessor = async (ctx: AppContext, account: AccountWithUser, processor: CronProcessor, platform: Platform): Promise<RawSnapshot | null> =>
	pipe(decrypt(account.access_token_encrypted, ctx.encryptionKey))
		.map_err((e): ProcessingError => ({ kind: e.kind, message: e.message }))
		.tap_err(() => logAccount.error("Decryption failed", { platform, account_id: account.id }))
		.flat_map(async (token): Promise<Result<PlatformProcessResult, ProcessingError>> => {
			const provider = processor.createProvider(ctx);
			return processor.processAccount(ctx.backend, account.id, token, provider, account);
		})
		.tap_err(e => {
			logAccount.error("Processing failed", { platform, account_id: account.id, error: e });
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

const processGenericAccount = async (ctx: AppContext, account: AccountWithUser): Promise<RawSnapshot | null> =>
	pipe(decrypt(account.access_token_encrypted, ctx.encryptionKey))
		.map_err((e): CronError => ({ kind: "encryption_error", operation: "decrypt", message: e.message }))
		.flat_map(token => {
			const result = ctx.providerFactory.create(account.platform, account.platform_user_id, token);
			return pipe(result)
				.map_err(e => toProcessError(e))
				.tap_err(() => recordFailure(ctx.db, account.id))
				.result();
		})
		.flat_map(raw_data =>
			pipe(createRawStore(ctx.backend, account.platform, account.id))
				.map_err((e): CronError => ({ kind: "store_error", operation: "create", message: e.message ?? "unknown" }))
				.map(({ store }) => ({ raw_data, store }))
				.result()
		)
		.flat_map(({ raw_data, store }) =>
			pipe(store.put(raw_data as RawData, { tags: [`platform:${account.platform}`, `account:${account.id}`] }))
				.map_err((e): CronError => ({ kind: "store_error", operation: "put", message: String(e) }))
				.map((result: { version: string }) => ({ raw_data, version: result.version }))
				.result()
		)
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

	switch (platform) {
		case "github": {
			const provider = ctx.gitHubProvider ?? new GitHubProvider();
			const processor: CronProcessor = {
				shouldFetch: () => true,
				createProvider: () => provider,
				processAccount: processGitHubAccount as CronProcessor["processAccount"],
			};
			return processPlatformAccountWithProcessor(ctx, account, processor, platform);
		}
		case "reddit": {
			const provider = new RedditProvider();
			const processor: CronProcessor = {
				shouldFetch: () => true,
				createProvider: () => provider,
				processAccount: (backend, accountId, token, p, acc) => processRedditAccount(backend, accountId, token, p as RedditProvider, acc),
			};
			return processPlatformAccountWithProcessor(ctx, account, processor, platform);
		}
		case "twitter": {
			if (!shouldFetchForPlatform("twitter", account.last_fetched_at ?? null)) {
				return null;
			}
			const provider = ctx.twitterProvider ?? new TwitterProvider();
			const processor: CronProcessor = {
				shouldFetch: () => true,
				createProvider: () => provider,
				processAccount: processTwitterAccount as CronProcessor["processAccount"],
			};
			return processPlatformAccountWithProcessor(ctx, account, processor, platform);
		}
		default:
			return processGenericAccount(ctx, account);
	}
};

export const regenerateTimelinesForUsers = async (backend: Backend, updatedUsers: Set<string>, userAccounts: Map<string, AccountWithUser[]>): Promise<number> => {
	let timelinesGenerated = 0;
	for (const userId of updatedUsers) {
		const userAccountsList = userAccounts.get(userId) ?? [];
		const snapshots = await gatherLatestSnapshots(backend, userAccountsList);
		await combineUserTimeline(backend, userId, snapshots);
		timelinesGenerated++;
	}
	return timelinesGenerated;
};

// ============================================================================
// Timeline Builder
// ============================================================================

const logTimeline = createLogger("sync:timeline");

type TimelineEntry = TimelineItem | CommitGroup;

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

const normalizeSnapshot = (snapshot: RawSnapshot): Result<TimelineItem[], NormalizeError> =>
	try_catch(
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
					logTimeline.warn("Unknown platform in normalizeSnapshot", { platform: snapshot.platform });
					return [];
				}
			}
		},
		(e): NormalizeError => ({ kind: "parse_error", platform: snapshot.platform, message: String(e) })
	);

export const normalizeOtherSnapshots = (snapshots: RawSnapshot[]): TimelineItem[] => {
	const results = snapshots.map(snapshot => normalizeSnapshot(snapshot));

	for (const r of results) {
		if (!r.ok) {
			logTimeline.error("Normalization failed", { platform: r.error.platform, message: r.error.message });
		}
	}

	return results.filter((r): r is { ok: true; value: TimelineItem[] } => r.ok).flatMap(r => r.value);
};

export const generateTimeline = (userId: string, items: TimelineItem[]) => {
	logTimeline.debug("Generating timeline", { user_id: userId, item_count: items.length });

	const entries: TimelineEntry[] = groupCommits(items);
	const dateGroups = groupByDate(entries);

	logTimeline.debug("Timeline generated", { user_id: userId, entries: entries.length, date_groups: dateGroups.length });

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
		.tap_err(() => logTimeline.error("Timeline store creation failed", { user_id: userId }))
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

export const combineUserTimeline = async (backend: Backend, userId: string, snapshots: RawSnapshot[]): Promise<void> => {
	logTimeline.info("Building timeline", { user_id: userId, snapshot_count: snapshots.length });

	if (snapshots.length === 0) {
		await storeEmptyTimeline(backend, userId);
		return;
	}

	const byPlatform = groupSnapshotsByPlatform(snapshots);

	logTimeline.debug("Snapshots by platform", {
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

	logTimeline.info("Timeline items loaded", {
		github: githubItems.length,
		reddit: redditItems.length,
		twitter: twitterItems.length,
		other: otherItems.length,
		total: allItems.length,
	});

	const timeline = generateTimeline(userId, allItems);
	await storeTimeline(backend, userId, timeline, snapshots);

	logTimeline.info("Timeline stored", {
		user_id: userId,
		date_groups: timeline.groups.length,
		generated_at: timeline.generated_at,
	});
};
