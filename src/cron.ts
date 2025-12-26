import type { Backend } from "@f0rbit/corpus";
import { eq, sql } from "drizzle-orm";
import type { Database } from "./db";
import type { AppContext } from "./infrastructure";
import { normalizeBluesky, normalizeDevpad, normalizeGitHub, normalizeYouTube, type ProviderError, type ProviderFactory } from "./platforms";
import { accountMembers, accounts, BlueskyRawSchema, DevpadRawSchema, GitHubRawSchema, rateLimits, YouTubeRawSchema, type Platform, type TimelineItem, type CommitGroup } from "./schema";
import { createRawStore, createTimelineStore, rawStoreId, shouldFetch, type RawData, type RateLimitState } from "./storage";
import { groupByDate, groupCommits } from "./timeline";
import { decrypt, pipe, to_nullable, tryCatch, type Result } from "./utils";

export { processAccount, gatherLatestSnapshots, combineUserTimeline };
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
	console.log("[recordFailure] Recording failure for account:", accountId);
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
	console.log("[recordFailure] Failure recorded successfully for account:", accountId);
};

const recordSuccess = async (db: Database, accountId: string): Promise<void> => {
	console.log("[recordSuccess] Recording success for account:", accountId);
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
	console.log("[recordSuccess] Success recorded for account:", accountId);
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
	console.log("[processAccount] Starting for account:", { id: account.id, platform: account.platform, user_id: account.user_id, platform_user_id: account.platform_user_id });

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

	console.log("[processAccount] Rate limit state:", rateLimitRow);

	if (!shouldFetch(toRateLimitState(rateLimitRow ?? null))) {
		console.log("[processAccount] Skipping fetch due to rate limit state");
		return null;
	}

	console.log("[processAccount] Before decryption");
	return pipe(decrypt(account.access_token_encrypted, ctx.encryptionKey))
		.tap(() => console.log("[processAccount] Decryption result: success"))
		.mapErr((e): ProcessError => {
			console.log("[processAccount] Decryption result: failed -", e.message);
			return { kind: "decryption_failed", message: e.message };
		})
		.flatMap(token => {
			console.log("[processAccount] Before calling providerFactory.create:", { platform: account.platform, platformUserId: account.platform_user_id, hasToken: !!token });
			const result = ctx.providerFactory.create(account.platform, account.platform_user_id, token);
			console.log("[processAccount] providerFactory.create called, awaiting result...");
			return pipe(result)
				.tap(data => console.log("[processAccount] providerFactory.create result: success, data type:", typeof data))
				.mapErr(e => {
					console.log("[processAccount] providerFactory.create result: error -", e);
					return toProcessError(e);
				})
				.tapErr(() => recordFailure(ctx.db, account.id))
				.result();
		})
		.flatMap(rawData => {
			console.log("[processAccount] Before creating raw store for:", { platform: account.platform, accountId: account.id });
			return pipe(createRawStore(ctx.backend, account.platform, account.id))
				.tap(() => console.log("[processAccount] Raw store creation: success"))
				.mapErr((e): ProcessError => {
					console.log("[processAccount] Raw store creation: failed -", e);
					return { kind: "store_failed", store_id: e.store_id };
				})
				.map(({ store }) => ({ rawData, store }))
				.result();
		})
		.flatMap(({ rawData, store }) => {
			console.log("[processAccount] Before store.put");
			return pipe(store.put(rawData as RawData, { tags: [`platform:${account.platform}`, `account:${account.id}`] }))
				.tap(result => console.log("[processAccount] store.put result: success, version:", result.version))
				.mapErr((e): ProcessError => {
					console.log("[processAccount] store.put result: failed -", e);
					return { kind: "put_failed", message: String(e) };
				})
				.map((result: { version: string }) => ({ rawData, version: result.version }))
				.result();
		})
		.tapErr(logProcessError(account.id))
		.tap(() => {
			console.log("[processAccount] All operations successful, recording success");
			return recordSuccess(ctx.db, account.id);
		})
		.map((result: { rawData: Record<string, unknown>; version: string }): RawSnapshot => {
			console.log("[processAccount] Creating final snapshot:", { account_id: account.id, platform: account.platform, version: result.version });
			return {
				account_id: account.id,
				platform: account.platform,
				version: result.version,
				data: result.rawData,
			};
		})
		.unwrapOr(null as unknown as RawSnapshot)
		.then(r => {
			console.log("[processAccount] Final result:", r ? "snapshot created" : "null (failed or skipped)");
			return r as RawSnapshot | null;
		});
};

const getLatestSnapshot = async (backend: Backend, account: AccountWithUser): Promise<RawSnapshot | null> => {
	console.log("[getLatestSnapshot] Starting for account:", { id: account.id, platform: account.platform });
	const storeResult = createRawStore(backend, account.platform, account.id);
	console.log("[getLatestSnapshot] Store creation result:", storeResult.ok ? "success" : "failed");
	if (!storeResult.ok) {
		console.log("[getLatestSnapshot] Store creation failed, returning null");
		return null;
	}

	console.log("[getLatestSnapshot] Fetching latest snapshot from store...");
	const snapshot = to_nullable(await storeResult.value.store.get_latest());
	console.log("[getLatestSnapshot] Snapshot fetched:", snapshot ? "found" : "null");
	if (snapshot) {
		console.log("[getLatestSnapshot] Snapshot meta:", snapshot.meta);
		console.log("[getLatestSnapshot] Snapshot data preview:", JSON.stringify(snapshot.data).slice(0, 500));
	}
	if (!snapshot) {
		console.log("[getLatestSnapshot] No snapshot found, returning null");
		return null;
	}

	const result: RawSnapshot = {
		account_id: account.id,
		platform: account.platform,
		version: snapshot.meta.version,
		data: snapshot.data,
	};
	console.log("[getLatestSnapshot] Returning RawSnapshot:", { account_id: result.account_id, platform: result.platform, version: result.version });
	return result;
};

const gatherLatestSnapshots = async (backend: Backend, accounts: AccountWithUser[]): Promise<RawSnapshot[]> => {
	console.log(
		"[gatherLatestSnapshots] Starting with accounts:",
		accounts.map(a => ({ id: a.id, platform: a.platform }))
	);
	console.log("[gatherLatestSnapshots] Account count:", accounts.length);

	const results = await Promise.all(
		accounts.map(async (account, index) => {
			console.log(`[gatherLatestSnapshots] Processing account ${index + 1}/${accounts.length}:`, account.id);
			const snapshot = await getLatestSnapshot(backend, account);
			console.log(`[gatherLatestSnapshots] Account ${account.id} result:`, snapshot ? "snapshot found" : "null");
			return snapshot;
		})
	);

	console.log("[gatherLatestSnapshots] All results gathered, total:", results.length);
	const filtered = results.filter((s): s is RawSnapshot => s !== null);
	console.log("[gatherLatestSnapshots] Filtered results (non-null):", filtered.length);
	console.log(
		"[gatherLatestSnapshots] Filtered snapshots:",
		filtered.map(s => ({ account_id: s.account_id, platform: s.platform, version: s.version }))
	);
	return filtered;
};

const combineUserTimeline = async (backend: Backend, userId: string, snapshots: RawSnapshot[]): Promise<void> => {
	console.log("[combineUserTimeline] Starting for user:", userId);
	console.log("[combineUserTimeline] Input snapshots count:", snapshots.length);
	console.log(
		"[combineUserTimeline] Input snapshots platforms:",
		snapshots.map(s => s.platform)
	);
	console.log(
		"[combineUserTimeline] Input snapshots data sizes:",
		snapshots.map(s => JSON.stringify(s.data).length)
	);

	if (snapshots.length === 0) {
		console.log("[combineUserTimeline] No snapshots, returning early");
		return;
	}

	// Log each snapshot's data before normalization
	for (const snapshot of snapshots) {
		console.log(`[combineUserTimeline] Snapshot ${snapshot.platform} data preview:`, JSON.stringify(snapshot.data).slice(0, 200));
	}

	console.log("[combineUserTimeline] Normalizing snapshots...");
	const normalizeResults = snapshots.map((snapshot, index) => {
		console.log(`[combineUserTimeline] Normalizing snapshot ${index + 1}/${snapshots.length} (${snapshot.platform})...`);
		const result = normalizeSnapshot(snapshot);
		console.log(`[combineUserTimeline] Normalize result for ${snapshot.platform}:`, result.ok ? `ok, ${result.value.length} items` : `error: ${result.error.message}`);
		return result;
	});

	for (const r of normalizeResults) {
		if (!r.ok) {
			console.error(`[combineUserTimeline] Failed to normalize ${r.error.platform} data: ${r.error.message}`);
		}
	}

	const items = normalizeResults.filter((r): r is { ok: true; value: TimelineItem[] } => r.ok).flatMap(r => r.value);
	console.log("[combineUserTimeline] Items after filtering successful results:", items.length);
	console.log(
		"[combineUserTimeline] Items preview:",
		items.slice(0, 3).map(i => ({ id: i.id, type: i.type, platform: i.platform }))
	);

	const entries: TimelineEntry[] = groupCommits(items);
	console.log("[combineUserTimeline] Items after groupCommits:", entries.length);
	console.log(
		"[combineUserTimeline] Entry types:",
		entries.map(e => e.type)
	);

	const dateGroups = groupByDate(entries);
	console.log("[combineUserTimeline] DateGroups after groupByDate:", dateGroups.length);
	console.log(
		"[combineUserTimeline] DateGroups dates:",
		dateGroups.map(g => g.date)
	);
	console.log(
		"[combineUserTimeline] DateGroups items per date:",
		dateGroups.map(g => ({ date: g.date, count: g.items.length }))
	);

	const timeline = {
		user_id: userId,
		generated_at: new Date().toISOString(),
		groups: dateGroups,
	};
	console.log("[combineUserTimeline] Final timeline object:", { user_id: timeline.user_id, generated_at: timeline.generated_at, groups_count: timeline.groups.length });
	console.log("[combineUserTimeline] Timeline JSON preview:", JSON.stringify(timeline).slice(0, 500));

	const parents = snapshots.map(s => ({
		store_id: rawStoreId(s.platform, s.account_id),
		version: s.version,
		role: "source" as const,
	}));
	console.log("[combineUserTimeline] Parents for store:", parents);

	console.log("[combineUserTimeline] Creating timeline store...");
	await pipe(createTimelineStore(backend, userId))
		.tap(({ store, id }) => console.log("[combineUserTimeline] Timeline store created:", id))
		.tapErr(() => console.error(`[combineUserTimeline] Failed to create timeline store for user ${userId}`))
		.tap(async ({ store }) => {
			console.log("[combineUserTimeline] Putting timeline into store...");
			await store.put(timeline, { parents });
			console.log("[combineUserTimeline] Timeline stored successfully");
		})
		.result();

	console.log("[combineUserTimeline] Completed for user:", userId);
};

const normalizeSnapshot = (snapshot: RawSnapshot): Result<TimelineItem[], NormalizeError> => {
	console.log("[normalizeSnapshot] Starting for platform:", snapshot.platform);
	console.log("[normalizeSnapshot] Raw data preview:", JSON.stringify(snapshot.data).slice(0, 500));

	return tryCatch(
		() => {
			console.log("[normalizeSnapshot] Matching platform case:", snapshot.platform);
			let result: TimelineItem[];
			switch (snapshot.platform as Platform) {
				case "github":
					console.log("[normalizeSnapshot] Case: github - parsing with GitHubRawSchema");
					const githubParsed = GitHubRawSchema.parse(snapshot.data);
					console.log("[normalizeSnapshot] GitHub parsed successfully, events count:", githubParsed.events?.length ?? 0);
					result = normalizeGitHub(githubParsed);
					console.log("[normalizeSnapshot] GitHub normalized, items count:", result.length);
					break;
				case "bluesky":
					console.log("[normalizeSnapshot] Case: bluesky - parsing with BlueskyRawSchema");
					const blueskyParsed = BlueskyRawSchema.parse(snapshot.data);
					console.log("[normalizeSnapshot] Bluesky parsed successfully");
					result = normalizeBluesky(blueskyParsed);
					console.log("[normalizeSnapshot] Bluesky normalized, items count:", result.length);
					break;
				case "youtube":
					console.log("[normalizeSnapshot] Case: youtube - parsing with YouTubeRawSchema");
					const youtubeParsed = YouTubeRawSchema.parse(snapshot.data);
					console.log("[normalizeSnapshot] YouTube parsed successfully");
					result = normalizeYouTube(youtubeParsed);
					console.log("[normalizeSnapshot] YouTube normalized, items count:", result.length);
					break;
				case "devpad":
					console.log("[normalizeSnapshot] Case: devpad - parsing with DevpadRawSchema");
					const devpadParsed = DevpadRawSchema.parse(snapshot.data);
					console.log("[normalizeSnapshot] Devpad parsed successfully");
					result = normalizeDevpad(devpadParsed);
					console.log("[normalizeSnapshot] Devpad normalized, items count:", result.length);
					break;
				default:
					console.log("[normalizeSnapshot] Case: default (unknown platform), returning empty array");
					result = [];
			}
			console.log("[normalizeSnapshot] Final result items count:", result.length);
			if (result.length > 0) {
				console.log("[normalizeSnapshot] First item preview:", JSON.stringify(result[0]).slice(0, 300));
			}
			return result;
		},
		(e): NormalizeError => {
			console.log("[normalizeSnapshot] ERROR during normalization:", String(e));
			return { kind: "parse_error", platform: snapshot.platform, message: String(e) };
		}
	);
};
