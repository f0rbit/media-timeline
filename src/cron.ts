import type { Backend } from "@f0rbit/corpus";
import { eq, sql } from "drizzle-orm";
import type { Database } from "./db";
import type { AppContext } from "./infrastructure";
import { normalizeBluesky, normalizeDevpad, normalizeGitHub, normalizeYouTube, type ProviderError, type ProviderFactory } from "./platforms";
import { accountMembers, accounts, BlueskyRawSchema, DevpadRawSchema, GitHubRawSchema, rateLimits, YouTubeRawSchema, type Platform, type TimelineItem, type CommitGroup } from "./schema";
import { createRawStore, createTimelineStore, rawStoreId, shouldFetch, type RawData, type RateLimitState } from "./storage";
import { groupByDate, groupCommits } from "./timeline";
import { decrypt, pipe, to_nullable, tryCatch, type Result } from "./utils";

export type { ProviderFactory };

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

type NormalizeError = { kind: "parse_error"; platform: string; message: string };

type ProcessError = { kind: "decryption_failed"; message: string } | { kind: "fetch_failed"; message: string; status?: number } | { kind: "store_failed"; store_id: string } | { kind: "put_failed"; message: string };

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

const toProcessError = (e: ProviderError): ProcessError => ({
	kind: "fetch_failed",
	message: formatProviderError(e),
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
			pipe(ctx.providerFactory.create(account.platform, account.platform_user_id, token))
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

const getLatestSnapshot = async (backend: Backend, account: AccountWithUser): Promise<RawSnapshot | null> => {
	const storeResult = createRawStore(backend, account.platform, account.id);
	if (!storeResult.ok) return null;

	const snapshot = to_nullable(await storeResult.value.store.get_latest());
	if (!snapshot) return null;

	return {
		account_id: account.id,
		platform: account.platform,
		version: snapshot.meta.version,
		data: snapshot.data,
	};
};

const gatherLatestSnapshots = (backend: Backend, accounts: AccountWithUser[]): Promise<RawSnapshot[]> =>
	Promise.all(accounts.map(account => getLatestSnapshot(backend, account))).then(results => results.filter((s): s is RawSnapshot => s !== null));

const combineUserTimeline = async (backend: Backend, userId: string, snapshots: RawSnapshot[]): Promise<void> => {
	if (snapshots.length === 0) return;

	const normalizeResults = snapshots.map(normalizeSnapshot);

	for (const r of normalizeResults) {
		if (!r.ok) {
			console.error(`Failed to normalize ${r.error.platform} data: ${r.error.message}`);
		}
	}

	const items = normalizeResults.filter((r): r is { ok: true; value: TimelineItem[] } => r.ok).flatMap(r => r.value);

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

const normalizeSnapshot = (snapshot: RawSnapshot): Result<TimelineItem[], NormalizeError> =>
	tryCatch(
		() => {
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
		},
		(e): NormalizeError => ({ kind: "parse_error", platform: snapshot.platform, message: String(e) })
	);
