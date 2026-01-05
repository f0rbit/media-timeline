import { type AccountId, type Platform, type ProfileId, type UserId, accountSettings, accounts, errors, profileId, profiles } from "@media/schema";
import type { ApiError, BadRequestError, EncryptionError, NotFoundError } from "@media/schema";
import { and, eq } from "drizzle-orm";
import { requireAccountOwnership, requireProfileOwnership } from "../auth-ownership";
import { deleteConnection } from "../connection-delete";
import { processRedditAccount } from "../cron/processors/reddit";
import type { Database } from "../db";
import type { AppContext } from "../infrastructure";
import { createLogger } from "../logger";
import type { AccountWithUser } from "../platforms/registry";
import { RedditProvider } from "../platforms/reddit";
import { refreshRedditToken } from "../routes/auth";
import { createGitHubMetaStore, createRedditMetaStore } from "../storage";
import { combineUserTimeline, gatherLatestSnapshots, processAccount } from "../sync";
import { type Result, decrypt, encrypt, match, ok, parseSettingsMap, pipe, uuid } from "../utils";
import type { ServiceError } from "../utils/route-helpers";
import { getCredentials } from "./credentials";

export type { AccountWithUser };

export type RefreshError = BadRequestError | EncryptionError | ApiError | NotFoundError;

export type CategorizedAccounts<T> = {
	github: T[];
	reddit: T[];
	twitter: T[];
	other: T[];
};

export type RefreshStrategy = "github" | "reddit" | "twitter" | "generic";

export type RefreshAttempt = {
	accountId: string;
	success: boolean;
	error?: string;
};

type RefreshSuccess = { status: "processing"; message: string; platform: "github" | "reddit" } | { status: "refreshed"; account_id: string } | { status: "skipped"; message: string };

type RefreshAllSuccess = {
	status: "processing" | "completed";
	message?: string;
	succeeded: number;
	failed: number;
	total: number;
	github_accounts: number;
	reddit_accounts: number;
};

type BackgroundTask = () => Promise<void>;

type RefreshSingleResult = {
	result: Result<RefreshSuccess, RefreshError>;
	backgroundTask?: BackgroundTask;
};

type RefreshAllResult = {
	result: Result<RefreshAllSuccess, RefreshError>;
	backgroundTasks: BackgroundTask[];
};

type RefreshableAccountWithUser = AccountWithUser & { is_active: boolean };

type RefreshableAccount = {
	id: string;
	profile_id: string;
	refresh_token_encrypted: string | null;
};

type RedditCredentials = { clientId: string; clientSecret: string };

const log = createLogger("refresh");

export const categorizeAccountsByPlatform = <T extends { platform: string }>(accts: T[]): CategorizedAccounts<T> => ({
	github: accts.filter(a => a.platform === "github"),
	reddit: accts.filter(a => a.platform === "reddit"),
	twitter: accts.filter(a => a.platform === "twitter"),
	other: accts.filter(a => !["github", "reddit", "twitter"].includes(a.platform)),
});

export const determineRefreshStrategy = (platform: string): RefreshStrategy => {
	switch (platform) {
		case "github":
			return "github";
		case "reddit":
			return "reddit";
		case "twitter":
			return "twitter";
		default:
			return "generic";
	}
};

export const aggregateRefreshResults = (attempts: RefreshAttempt[]): { succeeded: number; failed: number; errors: string[] } =>
	attempts.reduce(
		(acc, a) => ({
			succeeded: acc.succeeded + (a.success ? 1 : 0),
			failed: acc.failed + (a.success ? 0 : 1),
			errors: a.error ? [...acc.errors, a.error] : acc.errors,
		}),
		{ succeeded: 0, failed: 0, errors: [] as string[] }
	);

export const shouldRegenerateTimeline = (succeeded: number): boolean => succeeded > 0;

const accountWithUserFields = {
	id: accounts.id,
	profile_id: accounts.profile_id,
	platform: accounts.platform,
	platform_user_id: accounts.platform_user_id,
	access_token_encrypted: accounts.access_token_encrypted,
	refresh_token_encrypted: accounts.refresh_token_encrypted,
	user_id: profiles.user_id,
} as const;

const accountWithUserFieldsWithFetchedAt = {
	...accountWithUserFields,
	last_fetched_at: accounts.last_fetched_at,
} as const;

export const fetchActiveAccountsForUser = async (db: Database, userId: string): Promise<AccountWithUser[]> =>
	db
		.select(accountWithUserFields)
		.from(accounts)
		.innerJoin(profiles, eq(accounts.profile_id, profiles.id))
		.where(and(eq(profiles.user_id, userId), eq(accounts.is_active, true)));

export type AccountWithUserAndStatus = AccountWithUser & { is_active: boolean | null };

export const fetchAccountByIdWithStatus = async (db: Database, accountId: string, userId: string): Promise<AccountWithUserAndStatus | undefined> =>
	db
		.select({ ...accountWithUserFields, is_active: accounts.is_active })
		.from(accounts)
		.innerJoin(profiles, eq(accounts.profile_id, profiles.id))
		.where(and(eq(profiles.user_id, userId), eq(accounts.id, accountId)))
		.get();

export const fetchAllActiveAccounts = async (db: Database): Promise<AccountWithUser[]> =>
	db.select(accountWithUserFieldsWithFetchedAt).from(accounts).innerJoin(profiles, eq(accounts.profile_id, profiles.id)).where(eq(accounts.is_active, true));

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

export const listConnections = async (ctx: AppContext, uid: UserId, profId: ProfileId, includeSettings: boolean): Promise<Result<{ accounts: ConnectionRow[] | ConnectionWithSettings[] }, ServiceError>> => {
	const ownershipResult = await requireProfileOwnership(ctx.db, uid, profId);
	if (!ownershipResult.ok) return ownershipResult;

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
		.where(eq(accounts.profile_id, profId));

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
	const profId = profileId(input.profile_id);
	const ownershipResult = await requireProfileOwnership(ctx.db, uid, profId);
	if (!ownershipResult.ok) return ownershipResult;

	const now = new Date().toISOString();
	const newAccountId = uuid();

	const encryptedAccessToken = await encrypt(input.access_token, ctx.encryptionKey);
	if (!encryptedAccessToken.ok) {
		return errors.encryptionError("encrypt", "Failed to encrypt access token");
	}

	let encryptedRefreshToken: string | null = null;
	if (input.refresh_token) {
		const refreshResult = await encrypt(input.refresh_token, ctx.encryptionKey);
		if (!refreshResult.ok) {
			return errors.encryptionError("encrypt", "Failed to encrypt refresh token");
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
		const { kind, message } = ownershipResult.error;
		if (kind === "not_found") return errors.notFound("account");
		return errors.forbidden(message);
	}

	const result = await deleteConnection({ db: ctx.db, backend: ctx.backend }, accId, uid);

	if (!result.ok) {
		const error = result.error;
		if (error.kind === "not_found") return errors.notFound("account");
		if (error.kind === "forbidden") return errors.forbidden("message" in error ? error.message : "Access denied");
		return errors.dbError("message" in error ? error.message : "Failed to delete connection", { operation: "delete_connection" });
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
		const userAccounts = await fetchActiveAccountsForUser(ctx.db, uid);
		const snapshots = await gatherLatestSnapshots(ctx.backend, userAccounts);
		await combineUserTimeline(ctx.backend, uid, snapshots);
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
		const { kind } = ownershipResult.error;
		if (kind === "not_found") return errors.notFound("account");
		return errors.forbidden("You do not own this account");
	}

	const now = new Date().toISOString();
	await ctx.db.update(accounts).set({ is_active: isActive, updated_at: now }).where(eq(accounts.id, accId));

	const updated = await ctx.db.select().from(accounts).where(eq(accounts.id, accId)).get();

	return ok({ success: true, connection: updated });
};

export const getConnectionSettings = async (ctx: AppContext, uid: UserId, accId: AccountId): Promise<Result<{ settings: Record<string, unknown> }, ServiceError>> => {
	const ownershipResult = await requireAccountOwnership(ctx.db, uid, accId);
	if (!ownershipResult.ok) {
		const { kind } = ownershipResult.error;
		if (kind === "not_found") return errors.notFound("account");
		return errors.forbidden("You do not own this account");
	}

	const settings = await ctx.db.select().from(accountSettings).where(eq(accountSettings.account_id, accId));
	const settingsMap = parseSettingsMap(settings);

	return ok({ settings: settingsMap });
};

export const updateConnectionSettings = async (ctx: AppContext, uid: UserId, accId: AccountId, newSettings: Record<string, unknown>): Promise<Result<{ updated: boolean }, ServiceError>> => {
	const ownershipResult = await requireAccountOwnership(ctx.db, uid, accId);
	if (!ownershipResult.ok) {
		const { kind } = ownershipResult.error;
		if (kind === "not_found") return errors.notFound("account");
		return errors.forbidden("You do not own this account");
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
		const { kind } = ownershipResult.error;
		if (kind === "not_found") return errors.notFound("account");
		return errors.forbidden("You do not own this account");
	}

	const account = await ctx.db.select({ id: accounts.id, platform: accounts.platform }).from(accounts).where(eq(accounts.id, accId)).get();

	if (!account) {
		return errors.notFound("account");
	}

	if (account.platform !== "github") {
		return errors.badRequest("Not a GitHub account");
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
		const { kind } = ownershipResult.error;
		if (kind === "not_found") return errors.notFound("account");
		return errors.forbidden("You do not own this account");
	}

	const account = await ctx.db.select({ id: accounts.id, platform: accounts.platform }).from(accounts).where(eq(accounts.id, accId)).get();

	if (!account) {
		return errors.notFound("account");
	}

	if (account.platform !== "reddit") {
		return errors.badRequest("Not a Reddit account");
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

const getRedditCredentials = async (ctx: AppContext, profileIdStr: string): Promise<RedditCredentials | null> => {
	const byoCredentials = await getCredentials(ctx, profileIdStr, "reddit");

	const clientId = byoCredentials?.clientId ?? ctx.env?.REDDIT_CLIENT_ID;
	const clientSecret = byoCredentials?.clientSecret ?? ctx.env?.REDDIT_CLIENT_SECRET;

	if (!clientId || !clientSecret) {
		return null;
	}

	return { clientId, clientSecret };
};

const attemptRedditTokenRefresh = async (ctx: AppContext, account: RefreshableAccount): Promise<Result<string, RefreshError>> => {
	if (!account.refresh_token_encrypted) {
		return errors.badRequest("No refresh token available");
	}

	const refreshTokenResult = await decrypt(account.refresh_token_encrypted, ctx.encryptionKey);
	if (!refreshTokenResult.ok) {
		return errors.encryptionError("decrypt", "Failed to decrypt refresh token");
	}

	const credentials = await getRedditCredentials(ctx, account.profile_id);
	if (!credentials) {
		log.error("No Reddit credentials available for token refresh", { account_id: account.id });
		return errors.badRequest("No Reddit credentials available");
	}

	log.info("Attempting Reddit token refresh", { account_id: account.id });

	const refreshResult = await refreshRedditToken(refreshTokenResult.value, credentials.clientId, credentials.clientSecret);
	if (!refreshResult.ok) {
		log.error("Reddit token refresh failed", { account_id: account.id, error: refreshResult.error });
		return errors.apiError(401, "Token refresh failed");
	}

	const newAccessToken = refreshResult.value.access_token;

	const encryptResult = await encrypt(newAccessToken, ctx.encryptionKey);
	if (!encryptResult.ok) {
		return errors.encryptionError("encrypt", "Failed to encrypt new access token");
	}

	const now = new Date().toISOString();
	await ctx.db
		.update(accounts)
		.set({
			access_token_encrypted: encryptResult.value,
			updated_at: now,
		})
		.where(eq(accounts.id, account.id));

	log.info("Reddit token refreshed successfully", { account_id: account.id });

	return ok(newAccessToken);
};

const lookupAccount = async (ctx: AppContext, accountId: string, userId: string): Promise<Result<RefreshableAccountWithUser, RefreshError>> => {
	const row = await fetchAccountByIdWithStatus(ctx.db, accountId, userId);

	if (!row) {
		return errors.notFound("account", accountId);
	}

	if (!row.is_active) {
		return errors.badRequest("Account is not active");
	}

	return ok({ ...row, is_active: true });
};

const regenerateTimeline = async (ctx: AppContext, userId: string, userAccounts: AccountWithUser[]): Promise<void> => {
	const snapshots = await gatherLatestSnapshots(ctx.backend, userAccounts);
	await combineUserTimeline(ctx.backend, userId, snapshots);
};

const processGitHubRefresh = async (ctx: AppContext, account: AccountWithUser, userId: string): Promise<RefreshSingleResult> => {
	const backgroundTask: BackgroundTask = async () => {
		try {
			const snapshot = await processAccount(ctx, account);
			if (snapshot) {
				const allUserAccounts = await fetchActiveAccountsForUser(ctx.db, userId);
				await regenerateTimeline(ctx, userId, allUserAccounts);
			}
		} catch (error) {
			log.error("GitHub background task failed", { account_id: account.id, user_id: userId, error: String(error) });
		}
	};

	return {
		result: ok({ status: "processing", message: "GitHub sync started in background", platform: "github" }),
		backgroundTask,
	};
};

const processRedditRefresh = async (ctx: AppContext, account: AccountWithUser, userId: string): Promise<RefreshSingleResult> => {
	const tokenResult = await pipe(decrypt(account.access_token_encrypted, ctx.encryptionKey))
		.map_err((): RefreshError => ({ kind: "encryption_error", operation: "decrypt", message: "Failed to decrypt Reddit token" }))
		.result();

	if (!tokenResult.ok) {
		return { result: { ok: false, error: tokenResult.error } };
	}
	let token = tokenResult.value;

	const backgroundTask: BackgroundTask = async () => {
		try {
			const provider = new RedditProvider();
			let result = await processRedditAccount(ctx.backend, account.id, token, provider, account);

			if (!result.ok && result.error.original_kind === "auth_expired") {
				log.info("Reddit token expired, attempting refresh", { account_id: account.id });

				const refreshResult = await attemptRedditTokenRefresh(ctx, account);
				if (refreshResult.ok) {
					token = refreshResult.value;
					result = await processRedditAccount(ctx.backend, account.id, token, provider, account);
				} else {
					log.error("Reddit token refresh failed", { account_id: account.id, error: refreshResult.error });
				}
			}

			if (result.ok) {
				const allUserAccounts = await fetchActiveAccountsForUser(ctx.db, userId);
				await regenerateTimeline(ctx, userId, allUserAccounts);
			} else {
				log.error("Reddit refresh failed", { account_id: account.id, error: result.error });
			}
		} catch (error) {
			log.error("Reddit background task failed", { account_id: account.id, user_id: userId, error: String(error) });
		}
	};

	return {
		result: ok({ status: "processing", message: "Reddit sync started in background", platform: "reddit" }),
		backgroundTask,
	};
};

const processGenericRefresh = async (ctx: AppContext, account: AccountWithUser, userId: string): Promise<RefreshSingleResult> => {
	const snapshot = await processAccount(ctx, account);

	if (snapshot) {
		const allUserAccounts = await fetchActiveAccountsForUser(ctx.db, userId);
		await regenerateTimeline(ctx, userId, allUserAccounts);

		return { result: ok({ status: "refreshed", account_id: account.id }) };
	}

	return { result: ok({ status: "skipped", message: "Rate limited or no changes" }) };
};

const refreshSingleAccount = async (ctx: AppContext, accountId: string, userId: string): Promise<RefreshSingleResult> => {
	log.info("Refreshing account", { account_id: accountId, user_id: userId });

	const accountResult = await pipe(lookupAccount(ctx, accountId, userId)).result();

	return match(
		accountResult,
		account => {
			const strategy = determineRefreshStrategy(account.platform);
			switch (strategy) {
				case "github":
					return processGitHubRefresh(ctx, account, userId);
				case "reddit":
					return processRedditRefresh(ctx, account, userId);
				case "twitter":
				case "generic":
					return processGenericRefresh(ctx, account, userId);
			}
		},
		error => Promise.resolve({ result: { ok: false as const, error } })
	);
};

const refreshAllAccounts = async (ctx: AppContext, userId: string): Promise<RefreshAllResult> => {
	log.info("Refreshing all accounts", { user_id: userId });

	const userAccounts = await fetchActiveAccountsForUser(ctx.db, userId);

	if (userAccounts.length === 0) {
		return {
			result: ok({ status: "completed", succeeded: 0, failed: 0, total: 0, github_accounts: 0, reddit_accounts: 0 }),
			backgroundTasks: [],
		};
	}

	const categorized = categorizeAccountsByPlatform(userAccounts);
	const { github: githubAccounts, reddit: redditAccounts, other: otherAccounts } = categorized;

	const backgroundTasks: BackgroundTask[] = [];

	if (githubAccounts.length > 0) {
		const githubTask: BackgroundTask = async () => {
			let bgSucceeded = 0;

			for (const account of githubAccounts) {
				try {
					const snapshot = await processAccount(ctx, account);
					if (snapshot) bgSucceeded++;
				} catch (e) {
					log.error("GitHub account refresh failed", { account_id: account.id, error: String(e) });
				}
			}

			if (shouldRegenerateTimeline(bgSucceeded)) {
				await regenerateTimeline(ctx, userId, userAccounts);
			}
		};
		backgroundTasks.push(githubTask);
	}

	if (redditAccounts.length > 0) {
		const redditTask: BackgroundTask = async () => {
			let bgSucceeded = 0;

			for (const account of redditAccounts) {
				try {
					const tokenResult = await pipe(decrypt(account.access_token_encrypted, ctx.encryptionKey))
						.map_err((): RefreshError => ({ kind: "encryption_error", operation: "decrypt", message: "Failed to decrypt Reddit token" }))
						.result();

					if (!tokenResult.ok) {
						log.error("Reddit token decryption failed", { account_id: account.id });
						continue;
					}
					let token = tokenResult.value;

					const provider = new RedditProvider();
					let result = await processRedditAccount(ctx.backend, account.id, token, provider, account);

					if (!result.ok && result.error.original_kind === "auth_expired") {
						log.info("Reddit token expired, attempting refresh", { account_id: account.id });

						const refreshResult = await attemptRedditTokenRefresh(ctx, account);
						if (refreshResult.ok) {
							token = refreshResult.value;
							result = await processRedditAccount(ctx.backend, account.id, token, provider, account);
						} else {
							log.error("Reddit token refresh failed", { account_id: account.id, error: refreshResult.error });
						}
					}

					if (result.ok) bgSucceeded++;
				} catch (e) {
					log.error("Reddit account refresh failed", { account_id: account.id, error: String(e) });
				}
			}

			if (shouldRegenerateTimeline(bgSucceeded)) {
				await regenerateTimeline(ctx, userId, userAccounts);
			}
		};
		backgroundTasks.push(redditTask);
	}

	let succeeded = 0;
	let failed = 0;

	for (const account of otherAccounts) {
		try {
			const snapshot = await processAccount(ctx, account);
			if (snapshot) {
				succeeded++;
			}
		} catch (e) {
			log.error("Account refresh failed", { account_id: account.id, error: String(e) });
			failed++;
		}
	}

	if (shouldRegenerateTimeline(succeeded)) {
		await regenerateTimeline(ctx, userId, otherAccounts);
	}

	const hasBackgroundTasks = backgroundTasks.length > 0;

	return {
		result: ok({
			status: hasBackgroundTasks ? "processing" : "completed",
			message: hasBackgroundTasks ? "GitHub/Reddit accounts syncing in background" : undefined,
			succeeded,
			failed,
			total: userAccounts.length,
			github_accounts: githubAccounts.length,
			reddit_accounts: redditAccounts.length,
		}),
		backgroundTasks,
	};
};

export const refreshConnection = async (ctx: AppContext, accountIdStr: string, uid: string) => refreshSingleAccount(ctx, accountIdStr, uid);

export const refreshAllUserConnections = async (ctx: AppContext, uid: string) => refreshAllAccounts(ctx, uid);
