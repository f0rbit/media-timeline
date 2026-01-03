import { type AccountId, type Platform, type UserId, accountSettings, accounts, profiles } from "@media/schema";
import { and, eq } from "drizzle-orm";
import { requireAccountOwnership } from "../auth-ownership";
import { deleteConnection } from "../connection-delete";
import { combineUserTimeline, gatherLatestSnapshots } from "../cron";
import type { AppContext } from "../infrastructure";
import { refreshAllAccounts, refreshSingleAccount } from "../refresh-service";
import { createGitHubMetaStore, createRedditMetaStore } from "../storage";
import { type Result, encrypt, err, ok, parseSettingsMap, uuid } from "../utils";
import type { ServiceError } from "../utils/route-helpers";

type ConnectionInput = {
	profile_id: string;
	platform: Platform;
	access_token: string;
	refresh_token?: string;
	platform_user_id?: string;
	platform_username?: string;
	token_expires_at?: string;
};

type ConnectionRow = {
	account_id: string;
	profile_id: string;
	platform: Platform;
	platform_username: string | null;
	is_active: boolean | null;
	last_fetched_at: string | null;
	created_at: string;
};

type ConnectionWithSettings = ConnectionRow & {
	settings: Record<string, unknown>;
};

export const listConnections = async (ctx: AppContext, uid: UserId, profileId: string, includeSettings: boolean): Promise<Result<{ accounts: ConnectionRow[] | ConnectionWithSettings[] }, ServiceError>> => {
	const profile = await ctx.db.select({ id: profiles.id, user_id: profiles.user_id }).from(profiles).where(eq(profiles.id, profileId)).get();

	if (!profile) {
		return err({ kind: "not_found", resource: "profile" });
	}

	if (profile.user_id !== uid) {
		return err({ kind: "forbidden", message: "You do not own this profile" });
	}

	const results = await ctx.db
		.select({
			account_id: accounts.id,
			profile_id: accounts.profile_id,
			platform: accounts.platform,
			platform_username: accounts.platform_username,
			is_active: accounts.is_active,
			last_fetched_at: accounts.last_fetched_at,
			created_at: accounts.created_at,
		})
		.from(accounts)
		.where(eq(accounts.profile_id, profileId));

	if (!includeSettings) {
		return ok({ accounts: results });
	}

	const accountsWithSettings = await Promise.all(
		results.map(async account => {
			const settings = await ctx.db.select().from(accountSettings).where(eq(accountSettings.account_id, account.account_id));
			const settingsMap = parseSettingsMap(settings);
			return { ...account, settings: settingsMap };
		})
	);

	return ok({ accounts: accountsWithSettings });
};

export const createConnection = async (ctx: AppContext, uid: UserId, input: ConnectionInput): Promise<Result<{ account_id: string; profile_id: string }, ServiceError>> => {
	const profile = await ctx.db.select({ id: profiles.id, user_id: profiles.user_id }).from(profiles).where(eq(profiles.id, input.profile_id)).get();

	if (!profile) {
		return err({ kind: "not_found", resource: "profile" });
	}

	if (profile.user_id !== uid) {
		return err({ kind: "forbidden", message: "You do not own this profile" });
	}

	const now = new Date().toISOString();
	const newAccountId = uuid();

	const encryptedAccessToken = await encrypt(input.access_token, ctx.encryptionKey);
	if (!encryptedAccessToken.ok) {
		return err({ kind: "encryption_failed", message: "Failed to encrypt access token" });
	}

	let encryptedRefreshToken: string | null = null;
	if (input.refresh_token) {
		const refreshResult = await encrypt(input.refresh_token, ctx.encryptionKey);
		if (!refreshResult.ok) {
			return err({ kind: "encryption_failed", message: "Failed to encrypt refresh token" });
		}
		encryptedRefreshToken = refreshResult.value;
	}

	await ctx.db.insert(accounts).values({
		id: newAccountId,
		profile_id: input.profile_id,
		platform: input.platform,
		platform_user_id: input.platform_user_id ?? null,
		platform_username: input.platform_username ?? null,
		access_token_encrypted: encryptedAccessToken.value,
		refresh_token_encrypted: encryptedRefreshToken,
		token_expires_at: input.token_expires_at ?? null,
		is_active: true,
		created_at: now,
		updated_at: now,
	});

	return ok({ account_id: newAccountId, profile_id: input.profile_id });
};

type DeleteResult = {
	deleted: boolean;
	account_id: string;
	platform: string;
	deleted_stores: number;
	affected_users: number;
};

export const removeConnection = async (ctx: AppContext, uid: UserId, accId: AccountId): Promise<Result<DeleteResult, ServiceError>> => {
	const ownershipResult = await requireAccountOwnership(ctx.db, uid, accId);
	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		if (status === 404) return err({ kind: "not_found", resource: "account" });
		return err({ kind: "forbidden", message });
	}

	const result = await deleteConnection({ db: ctx.db, backend: ctx.backend }, accId, uid);

	if (!result.ok) {
		const error = result.error;
		if (error.kind === "not_found") return err({ kind: "not_found", resource: "account" });
		if (error.kind === "forbidden") return err({ kind: "forbidden", message: "message" in error ? error.message : "Access denied" });
		return err({ kind: "db_error", message: "message" in error ? error.message : "Failed to delete connection" });
	}

	return ok({
		deleted: true,
		account_id: result.value.account_id,
		platform: result.value.platform,
		deleted_stores: result.value.deleted_stores.length,
		affected_users: result.value.affected_users.length,
	});
};

type DeleteWithRegenResult = {
	result: Result<DeleteResult, ServiceError>;
	backgroundTask: (() => Promise<void>) | null;
};

const createTimelineRegenTask = (ctx: AppContext, uid: UserId): (() => Promise<void>) => {
	return async () => {
		const affectedUsers = await ctx.db
			.select({ user_id: profiles.user_id })
			.from(accounts)
			.innerJoin(profiles, eq(accounts.profile_id, profiles.id))
			.where(eq(profiles.user_id, uid))
			.then(rows => [...new Set(rows.map(r => r.user_id))]);

		for (const affectedUserId of affectedUsers) {
			const userAccounts = await ctx.db
				.select({
					id: accounts.id,
					platform: accounts.platform,
					platform_user_id: accounts.platform_user_id,
					access_token_encrypted: accounts.access_token_encrypted,
					refresh_token_encrypted: accounts.refresh_token_encrypted,
					user_id: profiles.user_id,
				})
				.from(accounts)
				.innerJoin(profiles, eq(accounts.profile_id, profiles.id))
				.where(and(eq(profiles.user_id, affectedUserId), eq(accounts.is_active, true)));

			const snapshots = await gatherLatestSnapshots(ctx.backend, userAccounts);
			await combineUserTimeline(ctx.backend, affectedUserId, snapshots);
		}
	};
};

export const deleteConnectionWithTimelineRegen = async (ctx: AppContext, uid: UserId, accId: AccountId): Promise<DeleteWithRegenResult> => {
	const result = await removeConnection(ctx, uid, accId);

	if (!result.ok) {
		return { result, backgroundTask: null };
	}

	return { result, backgroundTask: createTimelineRegenTask(ctx, uid) };
};

export const updateConnectionStatus = async (ctx: AppContext, uid: UserId, accId: AccountId, isActive: boolean): Promise<Result<{ success: boolean; connection: unknown }, ServiceError>> => {
	const ownershipResult = await requireAccountOwnership(ctx.db, uid, accId);
	if (!ownershipResult.ok) {
		const { status } = ownershipResult.error;
		if (status === 404) return err({ kind: "not_found", resource: "account" });
		return err({ kind: "forbidden", message: "You do not own this account" });
	}

	const now = new Date().toISOString();
	await ctx.db.update(accounts).set({ is_active: isActive, updated_at: now }).where(eq(accounts.id, accId));

	const updated = await ctx.db.select().from(accounts).where(eq(accounts.id, accId)).get();

	return ok({ success: true, connection: updated });
};

export const getConnectionSettings = async (ctx: AppContext, uid: UserId, accId: AccountId): Promise<Result<{ settings: Record<string, unknown> }, ServiceError>> => {
	const ownershipResult = await requireAccountOwnership(ctx.db, uid, accId);
	if (!ownershipResult.ok) {
		const { status } = ownershipResult.error;
		if (status === 404) return err({ kind: "not_found", resource: "account" });
		return err({ kind: "forbidden", message: "You do not own this account" });
	}

	const settings = await ctx.db.select().from(accountSettings).where(eq(accountSettings.account_id, accId));
	const settingsMap = parseSettingsMap(settings);

	return ok({ settings: settingsMap });
};

export const updateConnectionSettings = async (ctx: AppContext, uid: UserId, accId: AccountId, newSettings: Record<string, unknown>): Promise<Result<{ updated: boolean }, ServiceError>> => {
	const ownershipResult = await requireAccountOwnership(ctx.db, uid, accId);
	if (!ownershipResult.ok) {
		const { status } = ownershipResult.error;
		if (status === 404) return err({ kind: "not_found", resource: "account" });
		return err({ kind: "forbidden", message: "You do not own this account" });
	}

	const now = new Date().toISOString();

	for (const [key, value] of Object.entries(newSettings)) {
		const existing = await ctx.db
			.select()
			.from(accountSettings)
			.where(and(eq(accountSettings.account_id, accId), eq(accountSettings.setting_key, key)))
			.get();

		if (existing) {
			await ctx.db
				.update(accountSettings)
				.set({ setting_value: JSON.stringify(value), updated_at: now })
				.where(eq(accountSettings.id, existing.id));
		} else {
			await ctx.db.insert(accountSettings).values({
				id: uuid(),
				account_id: accId,
				setting_key: key,
				setting_value: JSON.stringify(value),
				created_at: now,
				updated_at: now,
			});
		}
	}

	return ok({ updated: true });
};

type GitHubRepoInfo = {
	full_name: string;
	name: string;
	owner: string;
	is_private: boolean;
	default_branch: string;
	pushed_at: string | null;
};

export const getGitHubRepos = async (ctx: AppContext, uid: UserId, accId: AccountId): Promise<Result<{ repos: GitHubRepoInfo[] }, ServiceError>> => {
	const ownershipResult = await requireAccountOwnership(ctx.db, uid, accId);
	if (!ownershipResult.ok) {
		const { status } = ownershipResult.error;
		if (status === 404) return err({ kind: "not_found", resource: "account" });
		return err({ kind: "forbidden", message: "You do not own this account" });
	}

	const account = await ctx.db.select({ id: accounts.id, platform: accounts.platform }).from(accounts).where(eq(accounts.id, accId)).get();

	if (!account) {
		return err({ kind: "not_found", resource: "account" });
	}

	if (account.platform !== "github") {
		return err({ kind: "bad_request", message: "Not a GitHub account" });
	}

	const metaStoreResult = createGitHubMetaStore(ctx.backend, accId);
	if (!metaStoreResult.ok) {
		return ok({ repos: [] });
	}

	const latest = await metaStoreResult.value.store.get_latest();
	if (!latest.ok) {
		return ok({ repos: [] });
	}

	const repos: GitHubRepoInfo[] = latest.value.data.repositories.map(repo => ({
		full_name: repo.full_name,
		name: repo.name,
		owner: repo.owner,
		is_private: repo.is_private,
		default_branch: repo.default_branch,
		pushed_at: repo.pushed_at,
	}));

	return ok({ repos });
};

type SubredditResult = {
	subreddits: string[];
	username: string;
};

export const getRedditSubreddits = async (ctx: AppContext, uid: UserId, accId: AccountId): Promise<Result<SubredditResult, ServiceError>> => {
	const ownershipResult = await requireAccountOwnership(ctx.db, uid, accId);
	if (!ownershipResult.ok) {
		const { status } = ownershipResult.error;
		if (status === 404) return err({ kind: "not_found", resource: "account" });
		return err({ kind: "forbidden", message: "You do not own this account" });
	}

	const account = await ctx.db.select({ id: accounts.id, platform: accounts.platform }).from(accounts).where(eq(accounts.id, accId)).get();

	if (!account) {
		return err({ kind: "not_found", resource: "account" });
	}

	if (account.platform !== "reddit") {
		return err({ kind: "bad_request", message: "Not a Reddit account" });
	}

	const metaStoreResult = createRedditMetaStore(ctx.backend, accId);
	if (!metaStoreResult.ok) {
		return ok({ subreddits: [], username: "" });
	}

	const latest = await metaStoreResult.value.store.get_latest();
	if (!latest.ok || !latest.value) {
		return ok({ subreddits: [], username: "" });
	}

	return ok({
		subreddits: latest.value.data.subreddits_active,
		username: latest.value.data.username,
	});
};

export const refreshConnection = async (ctx: AppContext, accountIdStr: string, uid: string) => refreshSingleAccount(ctx, accountIdStr, uid);

export const refreshAllUserConnections = async (ctx: AppContext, uid: string) => refreshAllAccounts(ctx, uid);
