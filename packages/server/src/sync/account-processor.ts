import type { Backend } from "@f0rbit/corpus";
import type { CronError, Platform } from "@media/schema";
import { eq, sql } from "drizzle-orm";
import { accounts, rateLimits } from "@media/schema";
import type { Database } from "../db";
import type { AppContext } from "../infrastructure";
import { createLogger } from "../logger";
import { type CronProcessor, getCronProcessor, getPlatformCapabilities } from "../platforms";
import type { ProviderError, ProviderFactory } from "../platforms/types";
import { type RateLimitState, type RawData, createRawStore, shouldFetch } from "../storage";
import { type Result, decrypt, pipe, uuid } from "../utils";
import type { AccountWithUser, PlatformProcessResult, ProcessingError, RawSnapshot } from "./types";
import { combineUserTimeline, gatherLatestSnapshots } from "./timeline-builder";

const log = createLogger("sync:account");

type RateLimitRow = {
	remaining: number | null;
	reset_at: string | null;
	consecutive_failures: number | null;
	circuit_open_until: string | null;
};

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
				log.error("Encryption error", { account_id: accountId, operation: e.operation, message: e.message });
				break;
			case "network_error":
				log.error("Network error", { account_id: accountId, message: e.message });
				break;
			case "store_error":
				log.error("Store error", { account_id: accountId, operation: e.operation, message: e.message });
				break;
			case "auth_expired":
				log.error("Auth expired", { account_id: accountId, message: e.message });
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
	const processor = getCronProcessor(platform);

	if (!processor) {
		return processGenericAccount(ctx, account);
	}

	if (!processor.shouldFetch(account, account.last_fetched_at ?? null)) {
		return null;
	}

	return processPlatformAccountWithProcessor(ctx, account, processor, platform);
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

export { shouldFetchForPlatform };
