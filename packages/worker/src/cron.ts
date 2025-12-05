import {
	type BlueSkyRaw,
	type DevpadRaw,
	decrypt,
	err,
	fetchResult,
	type GitHubRaw,
	groupByDate,
	groupCommits,
	match,
	normalizeBlueSky,
	normalizeDevpad,
	normalizeGitHub,
	normalizeYouTube,
	pipe,
	type RateLimitState,
	type Result,
	shouldFetch,
	type TimelineEntry,
	type TimelineItem,
	type YouTubeRaw,
} from "@media-timeline/core";
import type { Bindings } from "./bindings";
import { createRawStore, createTimelineStore, rawStoreId } from "./corpus";

type Account = {
	id: string;
	platform: string;
	platform_user_id: string | null;
	access_token_encrypted: string;
	refresh_token_encrypted: string | null;
};

type AccountWithUser = Account & { user_id: string };

type RawSnapshot = {
	account_id: string;
	platform: string;
	version: string;
	data: unknown;
};

type RateLimitRow = {
	remaining: number | null;
	reset_at: string | null;
	consecutive_failures: number;
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

const parseDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

const toRateLimitState = (row: RateLimitRow | null): RateLimitState => ({
	remaining: row?.remaining ?? null,
	limit_total: null,
	reset_at: parseDate(row?.reset_at ?? null),
	consecutive_failures: row?.consecutive_failures ?? 0,
	last_failure_at: null,
	circuit_open_until: parseDate(row?.circuit_open_until ?? null),
});

const defaultProviderFactory: ProviderFactory = {
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

export async function handleCron(env: Bindings, providerFactory: ProviderFactory = defaultProviderFactory): Promise<CronResult> {
	const result: CronResult = {
		processed_accounts: 0,
		updated_users: [],
		failed_accounts: [],
		timelines_generated: 0,
	};

	const { results: accountsWithUsers } = await env.DB.prepare(`
      SELECT 
        a.id,
        a.platform,
        a.platform_user_id,
        a.access_token_encrypted,
        a.refresh_token_encrypted,
        am.user_id
      FROM accounts a
      INNER JOIN account_members am ON a.id = am.account_id
      WHERE a.is_active = 1
    `).all<AccountWithUser>();

	const userAccounts = new Map<string, AccountWithUser[]>();
	for (const account of accountsWithUsers) {
		const existing = userAccounts.get(account.user_id) ?? [];
		existing.push(account);
		userAccounts.set(account.user_id, existing);
	}

	const updatedUsers = new Set<string>();

	for (const [userId, accounts] of userAccounts) {
		const results = await Promise.allSettled(
			accounts.map(async account => {
				result.processed_accounts++;
				const snapshot = await processAccount(env, account, providerFactory);
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
		const accounts = userAccounts.get(userId) ?? [];
		const snapshots = await gatherLatestSnapshots(env, accounts);
		await combineUserTimeline(env, userId, snapshots);
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

const recordFailure = async (env: Bindings, accountId: string): Promise<void> => {
	const now = new Date().toISOString();
	await env.DB.prepare(`
		INSERT INTO rate_limits (id, account_id, consecutive_failures, last_failure_at, updated_at)
		VALUES (?, ?, 1, ?, ?)
		ON CONFLICT(account_id) DO UPDATE SET
			consecutive_failures = consecutive_failures + 1,
			last_failure_at = ?,
			updated_at = ?
	`)
		.bind(crypto.randomUUID(), accountId, now, now, now, now)
		.run();
};

const recordSuccess = async (env: Bindings, accountId: string): Promise<void> => {
	const now = new Date().toISOString();
	await env.DB.prepare(`
		INSERT INTO rate_limits (id, account_id, consecutive_failures, updated_at)
		VALUES (?, ?, 0, ?)
		ON CONFLICT (account_id) DO UPDATE SET consecutive_failures = 0, updated_at = ?
	`)
		.bind(crypto.randomUUID(), accountId, now, now)
		.run();
	await env.DB.prepare("UPDATE accounts SET last_fetched_at = ?, updated_at = ? WHERE id = ?").bind(now, now, accountId).run();
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

const processAccount = (env: Bindings, account: AccountWithUser, providerFactory: ProviderFactory): Promise<RawSnapshot | null> =>
	env.DB.prepare("SELECT remaining, reset_at, consecutive_failures, circuit_open_until FROM rate_limits WHERE account_id = ?")
		.bind(account.id)
		.first<RateLimitRow>()
		.then(rateLimitRow =>
			shouldFetch(toRateLimitState(rateLimitRow))
				? pipe(decrypt(account.access_token_encrypted, env.ENCRYPTION_KEY))
						.mapErr((e): ProcessError => ({ kind: "decryption_failed", message: e.message }))
						.flatMap(token =>
							pipe(providerFactory.create(account.platform, token))
								.mapErr(toProcessError)
								.tapErr(() => recordFailure(env, account.id))
								.result()
						)
						.flatMap(rawData =>
							pipe(createRawStore(account.platform, account.id, env))
								.mapErr((e): ProcessError => ({ kind: "store_failed", store_id: e.store_id }))
								.map(({ store }) => ({ rawData, store }))
								.result()
						)
						.flatMap(({ rawData, store }) =>
							pipe(store.put(rawData as Record<string, unknown>, { tags: [`platform:${account.platform}`, `account:${account.id}`] }))
								.mapErr((e): ProcessError => ({ kind: "put_failed", message: String(e) }))
								.map((result: { version: string }) => ({ rawData, version: result.version }))
								.result()
						)
						.tapErr(logProcessError(account.id))
						.tap(() => recordSuccess(env, account.id))
						.map(
							(result: { rawData: Record<string, unknown>; version: string }): RawSnapshot => ({
								account_id: account.id,
								platform: account.platform,
								version: result.version,
								data: result.rawData,
							})
						)
						.unwrapOr(null as unknown as RawSnapshot)
						.then(r => r as RawSnapshot | null)
				: Promise.resolve(null)
		);

const toFetchError = (e: { type: "network"; cause: unknown } | { type: "http"; status: number; statusText: string }, apiName: string): FetchError =>
	e.type === "http" ? { kind: "api_error", status: e.status, message: `${apiName} API error` } : { kind: "network_error", message: String(e.cause) };

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

const getLatestSnapshot = (env: Bindings, account: AccountWithUser): Promise<RawSnapshot | null> =>
	match(
		createRawStore(account.platform, account.id, env),
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

const gatherLatestSnapshots = (env: Bindings, accounts: AccountWithUser[]): Promise<RawSnapshot[]> =>
	Promise.all(accounts.map(account => getLatestSnapshot(env, account))).then(results => results.filter((s): s is RawSnapshot => s !== null));

const combineUserTimeline = async (env: Bindings, userId: string, snapshots: RawSnapshot[]): Promise<void> => {
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

	await pipe(createTimelineStore(userId, env))
		.tapErr(() => console.error(`Failed to create timeline store for user ${userId}`))
		.tap(({ store }) => store.put(timeline, { parents }).then(() => {}))
		.result();
};

const normalizeSnapshot = (snapshot: RawSnapshot): TimelineItem[] => {
	switch (snapshot.platform) {
		case "github":
			return normalizeGitHub(snapshot.data as GitHubRaw);
		case "bluesky":
			return normalizeBlueSky(snapshot.data as BlueSkyRaw);
		case "youtube":
			return normalizeYouTube(snapshot.data as YouTubeRaw);
		case "devpad":
			return normalizeDevpad(snapshot.data as DevpadRaw);
		default:
			return [];
	}
};
