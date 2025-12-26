import type { Backend } from "@f0rbit/corpus";
import { eq, sql } from "drizzle-orm";
import type { Database } from "./db";
import type { AppContext } from "./infrastructure";
import { normalizeBluesky, normalizeDevpad, normalizeGitHub, normalizeYouTube } from "./platforms";
import { accountMembers, accounts, BlueskyRawSchema, DevpadRawSchema, GitHubRawSchema, rateLimits, YouTubeRawSchema, type Platform, type TimelineItem, type CommitGroup } from "./schema";
import { createRawStore, createTimelineStore, rawStoreId, shouldFetch, type RawData, type RateLimitState } from "./storage";
import { groupByDate, groupCommits } from "./timeline";
import { decrypt, err, fetchResult, match, pipe, type Result } from "./utils";

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

type FetchError = { kind: "network_error"; message: string } | { kind: "api_error"; status: number; message: string } | { kind: "unknown_platform"; platform: string };

type ProcessError = { kind: "decryption_failed"; message: string } | { kind: "fetch_failed"; message: string; status?: number } | { kind: "store_failed"; store_id: string } | { kind: "put_failed"; message: string };

export type ProviderFactory = {
	create(platform: string, token: string): Promise<Result<Record<string, unknown>, FetchError>>;
};

type TimelineEntry = TimelineItem | CommitGroup;

const parseDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

const toRateLimitState = (row: RateLimitRow | null): RateLimitState => ({
	remaining: row?.remaining ?? null,
	limit_total: null,
	reset_at: parseDate(row?.reset_at ?? null),
	consecutive_failures: row?.consecutive_failures ?? 0,
	last_failure_at: null,
	circuit_open_until: parseDate(row?.circuit_open_until ?? null),
});

export const defaultProviderFactory: ProviderFactory = {
	async create(platform, token) {
		switch (platform) {
			case "github":
				return fetchGitHub(token);
			case "bluesky":
				return fetchBluesky(token);
			case "youtube":
				return fetchYouTube(token);
			case "devpad":
				return fetchDevpad(token);
			default:
				return err({ kind: "unknown_platform", platform });
		}
	},
};

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

const formatFetchError = (e: FetchError): string => {
	switch (e.kind) {
		case "api_error":
			return `API error ${e.status}`;
		case "unknown_platform":
			return `Unknown platform: ${e.platform}`;
		case "network_error":
			return e.message;
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
	(accountId: string) =>
	(e: ProcessError): void => {
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

const toProcessError = (e: FetchError): ProcessError => ({
	kind: "fetch_failed",
	message: formatFetchError(e),
	status: e.kind === "api_error" ? e.status : undefined,
});

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

	return pipe(decrypt(account.access_token_encrypted, ctx.encryptionKey))
		.mapErr((e): ProcessError => ({ kind: "decryption_failed", message: e.message }))
		.flatMap(token =>
			pipe(ctx.providerFactory.create(account.platform, token))
				.mapErr(toProcessError)
				.tapErr(() => recordFailure(ctx.db, account.id))
				.result()
		)
		.flatMap(rawData =>
			pipe(createRawStore(ctx.backend, account.platform, account.id))
				.mapErr((e): ProcessError => ({ kind: "store_failed", store_id: e.store_id }))
				.map(({ store }) => ({ rawData, store }))
				.result()
		)
		.flatMap(({ rawData, store }) =>
			pipe(store.put(rawData as RawData, { tags: [`platform:${account.platform}`, `account:${account.id}`] }))
				.mapErr((e): ProcessError => ({ kind: "put_failed", message: String(e) }))
				.map((result: { version: string }) => ({ rawData, version: result.version }))
				.result()
		)
		.tapErr(logProcessError(account.id))
		.tap(() => recordSuccess(ctx.db, account.id))
		.map(
			(result: { rawData: Record<string, unknown>; version: string }): RawSnapshot => ({
				account_id: account.id,
				platform: account.platform,
				version: result.version,
				data: result.rawData,
			})
		)
		.unwrapOr(null as unknown as RawSnapshot)
		.then(r => r as RawSnapshot | null);
};

type InternalFetchError = { type: "network"; cause: unknown } | { type: "http"; status: number; statusText: string };

const toFetchError = (e: InternalFetchError, apiName: string): FetchError => (e.type === "http" ? { kind: "api_error", status: e.status, message: `${apiName} API error` } : { kind: "network_error", message: String(e.cause) });

const fetchGitHub = (token: string): Promise<Result<Record<string, unknown>, FetchError>> =>
	pipe(
		fetchResult<unknown[], FetchError>(
			"https://api.github.com/users/me/events?per_page=100",
			{
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
				},
			},
			e => toFetchError(e, "GitHub")
		)
	)
		.map(events => ({ events, fetched_at: new Date().toISOString() }))
		.result();

const fetchBluesky = (token: string): Promise<Result<Record<string, unknown>, FetchError>> =>
	pipe(fetchResult<Record<string, unknown>, FetchError>("https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?limit=100", { headers: { Authorization: `Bearer ${token}` } }, e => toFetchError(e, "Bluesky")))
		.map(data => ({ ...data, fetched_at: new Date().toISOString() }))
		.result();

const fetchYouTube = (token: string): Promise<Result<Record<string, unknown>, FetchError>> =>
	pipe(
		fetchResult<Record<string, unknown>, FetchError>("https://www.googleapis.com/youtube/v3/search?part=snippet&forMine=true&type=video&maxResults=50", { headers: { Authorization: `Bearer ${token}` } }, e => toFetchError(e, "YouTube"))
	)
		.map(data => ({ ...data, fetched_at: new Date().toISOString() }))
		.result();

const fetchDevpad = (token: string): Promise<Result<Record<string, unknown>, FetchError>> =>
	pipe(fetchResult<{ tasks: unknown }, FetchError>("https://api.devpad.io/tasks", { headers: { Authorization: `Bearer ${token}` } }, e => toFetchError(e, "Devpad")))
		.map(({ tasks }) => ({ tasks, fetched_at: new Date().toISOString() }))
		.result();

const getLatestSnapshot = (backend: Backend, account: AccountWithUser): Promise<RawSnapshot | null> =>
	match(
		createRawStore(backend, account.platform, account.id),
		async ({ store }) =>
			match(
				(await store.get_latest()) as Result<{ meta: { version: string }; data: unknown }, unknown>,
				({ meta, data }): RawSnapshot => ({
					account_id: account.id,
					platform: account.platform,
					version: meta.version,
					data,
				}),
				() => null
			),
		() => Promise.resolve(null)
	);

const gatherLatestSnapshots = (backend: Backend, accounts: AccountWithUser[]): Promise<RawSnapshot[]> =>
	Promise.all(accounts.map(account => getLatestSnapshot(backend, account))).then(results => results.filter((s): s is RawSnapshot => s !== null));

const combineUserTimeline = async (backend: Backend, userId: string, snapshots: RawSnapshot[]): Promise<void> => {
	if (snapshots.length === 0) return;

	const items = snapshots.flatMap(normalizeSnapshot);
	const entries: TimelineEntry[] = groupCommits(items);
	const dateGroups = groupByDate(entries);

	const timeline = {
		user_id: userId,
		generated_at: new Date().toISOString(),
		groups: dateGroups,
	};

	const parents = snapshots.map(s => ({
		store_id: rawStoreId(s.platform, s.account_id),
		version: s.version,
		role: "source" as const,
	}));

	await pipe(createTimelineStore(backend, userId))
		.tapErr(() => console.error(`Failed to create timeline store for user ${userId}`))
		.tap(({ store }) => store.put(timeline, { parents }).then(() => {}))
		.result();
};

const normalizeSnapshot = (snapshot: RawSnapshot): TimelineItem[] => {
	switch (snapshot.platform as Platform) {
		case "github":
			return normalizeGitHub(GitHubRawSchema.parse(snapshot.data));
		case "bluesky":
			return normalizeBluesky(BlueskyRawSchema.parse(snapshot.data));
		case "youtube":
			return normalizeYouTube(YouTubeRawSchema.parse(snapshot.data));
		case "devpad":
			return normalizeDevpad(DevpadRawSchema.parse(snapshot.data));
		default:
			return [];
	}
};
