import { accounts, profiles } from "@media/schema";
import { and, eq } from "drizzle-orm";
import { processRedditAccount } from "./cron-reddit";
import type { RefreshError } from "./errors";
import type { AppContext } from "./infrastructure";
import { createLogger } from "./logger";
import { RedditProvider } from "./platforms/reddit";
import { refreshRedditToken } from "./routes/auth";
import { getCredentials } from "./services/credentials";
import { type Result, decrypt, encrypt, err, match, ok, pipe } from "./utils";

const log = createLogger("refresh");

// Pure function types
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

// Pure functions for testability
export const categorizeAccountsByPlatform = <T extends { platform: string }>(accounts: T[]): CategorizedAccounts<T> => ({
	github: accounts.filter(a => a.platform === "github"),
	reddit: accounts.filter(a => a.platform === "reddit"),
	twitter: accounts.filter(a => a.platform === "twitter"),
	other: accounts.filter(a => !["github", "reddit", "twitter"].includes(a.platform)),
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

type AccountWithUser = {
	id: string;
	profile_id: string;
	platform: string;
	platform_user_id: string | null;
	access_token_encrypted: string;
	refresh_token_encrypted: string | null;
	is_active: boolean;
	user_id: string;
};

type RefreshSuccess = { status: "processing"; message: string; platform: "github" | "reddit" } | { status: "refreshed"; account_id: string } | { status: "skipped"; message: string };

type RedditCredentials = { clientId: string; clientSecret: string };

const getRedditCredentials = async (ctx: AppContext, profileId: string): Promise<RedditCredentials | null> => {
	const byoCredentials = await getCredentials(ctx, profileId, "reddit");

	const clientId = byoCredentials?.clientId ?? ctx.env?.REDDIT_CLIENT_ID;
	const clientSecret = byoCredentials?.clientSecret ?? ctx.env?.REDDIT_CLIENT_SECRET;

	if (!clientId || !clientSecret) {
		return null;
	}

	return { clientId, clientSecret };
};

type RefreshableAccount = {
	id: string;
	profile_id: string;
	refresh_token_encrypted: string | null;
};

const attemptRedditTokenRefresh = async (ctx: AppContext, account: RefreshableAccount): Promise<Result<string, RefreshError>> => {
	if (!account.refresh_token_encrypted) {
		return err({ kind: "no_refresh_token", message: "No refresh token available" });
	}

	const refreshTokenResult = await decrypt(account.refresh_token_encrypted, ctx.encryptionKey);
	if (!refreshTokenResult.ok) {
		return err({ kind: "decryption_failed", message: "Failed to decrypt refresh token" });
	}

	const credentials = await getRedditCredentials(ctx, account.profile_id);
	if (!credentials) {
		log.error("No Reddit credentials available for token refresh", { account_id: account.id });
		return err({ kind: "no_credentials", message: "No Reddit credentials available" });
	}

	log.info("Attempting Reddit token refresh", { account_id: account.id });

	const refreshResult = await refreshRedditToken(refreshTokenResult.value, credentials.clientId, credentials.clientSecret);
	if (!refreshResult.ok) {
		log.error("Reddit token refresh failed", { account_id: account.id, error: refreshResult.error });
		return err({ kind: "refresh_failed", message: "Token refresh failed" });
	}

	const newAccessToken = refreshResult.value.access_token;

	const encryptResult = await encrypt(newAccessToken, ctx.encryptionKey);
	if (!encryptResult.ok) {
		return err({ kind: "encryption_failed", message: "Failed to encrypt new access token" });
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

const lookupAccount = async (ctx: AppContext, accountId: string, userId: string): Promise<Result<AccountWithUser, RefreshError>> => {
	const row = await ctx.db
		.select({
			id: accounts.id,
			profile_id: accounts.profile_id,
			platform: accounts.platform,
			platform_user_id: accounts.platform_user_id,
			access_token_encrypted: accounts.access_token_encrypted,
			refresh_token_encrypted: accounts.refresh_token_encrypted,
			is_active: accounts.is_active,
			user_id: profiles.user_id,
		})
		.from(accounts)
		.innerJoin(profiles, eq(accounts.profile_id, profiles.id))
		.where(and(eq(profiles.user_id, userId), eq(accounts.id, accountId)))
		.get();

	if (!row) {
		return err({ kind: "not_found", message: "Account not found" });
	}

	if (!row.is_active) {
		return err({ kind: "inactive", message: "Account is not active" });
	}

	return ok({
		id: row.id,
		profile_id: row.profile_id,
		platform: row.platform,
		platform_user_id: row.platform_user_id,
		access_token_encrypted: row.access_token_encrypted,
		refresh_token_encrypted: row.refresh_token_encrypted,
		is_active: true,
		user_id: row.user_id,
	});
};

const fetchUserAccounts = async (ctx: AppContext, userId: string) =>
	ctx.db
		.select({
			id: accounts.id,
			profile_id: accounts.profile_id,
			platform: accounts.platform,
			platform_user_id: accounts.platform_user_id,
			access_token_encrypted: accounts.access_token_encrypted,
			refresh_token_encrypted: accounts.refresh_token_encrypted,
			user_id: profiles.user_id,
		})
		.from(accounts)
		.innerJoin(profiles, eq(accounts.profile_id, profiles.id))
		.where(and(eq(profiles.user_id, userId), eq(accounts.is_active, true)));

const processGitHubRefresh = async (ctx: AppContext, account: AccountWithUser, userId: string): Promise<RefreshSingleResult> => {
	const { processAccount, gatherLatestSnapshots, combineUserTimeline } = await import("./cron");

	const backgroundTask: BackgroundTask = async () => {
		try {
			const snapshot = await processAccount(ctx, account);
			if (snapshot) {
				const allUserAccounts = await fetchUserAccounts(ctx, userId);
				const snapshots = await gatherLatestSnapshots(ctx.backend, allUserAccounts);
				await combineUserTimeline(ctx.backend, userId, snapshots);
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
		.map_err((): RefreshError => ({ kind: "decryption_failed", message: "Failed to decrypt Reddit token" }))
		.result();

	if (!tokenResult.ok) {
		return { result: err(tokenResult.error) };
	}
	let token = tokenResult.value;

	const { gatherLatestSnapshots, combineUserTimeline } = await import("./cron");

	const backgroundTask: BackgroundTask = async () => {
		try {
			const provider = new RedditProvider();
			let result = await processRedditAccount(ctx.backend, account.id, token, provider);

			if (!result.ok && result.error.original_kind === "auth_expired") {
				log.info("Reddit token expired, attempting refresh", { account_id: account.id });

				const refreshResult = await attemptRedditTokenRefresh(ctx, account);
				if (refreshResult.ok) {
					token = refreshResult.value;
					result = await processRedditAccount(ctx.backend, account.id, token, provider);
				} else {
					log.error("Reddit token refresh failed", { account_id: account.id, error: refreshResult.error });
				}
			}

			if (result.ok) {
				const allUserAccounts = await fetchUserAccounts(ctx, userId);
				const snapshots = await gatherLatestSnapshots(ctx.backend, allUserAccounts);
				await combineUserTimeline(ctx.backend, userId, snapshots);
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
	const { processAccount, gatherLatestSnapshots, combineUserTimeline } = await import("./cron");

	const snapshot = await processAccount(ctx, account);

	if (snapshot) {
		const allUserAccounts = await fetchUserAccounts(ctx, userId);
		const snapshots = await gatherLatestSnapshots(ctx.backend, allUserAccounts);
		await combineUserTimeline(ctx.backend, userId, snapshots);

		return { result: ok({ status: "refreshed", account_id: account.id }) };
	}

	return { result: ok({ status: "skipped", message: "Rate limited or no changes" }) };
};

export const refreshSingleAccount = async (ctx: AppContext, accountId: string, userId: string): Promise<RefreshSingleResult> => {
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
		error => Promise.resolve({ result: err(error) })
	);
};

export const refreshAllAccounts = async (ctx: AppContext, userId: string): Promise<RefreshAllResult> => {
	log.info("Refreshing all accounts", { user_id: userId });

	const userAccounts = await ctx.db
		.select({
			id: accounts.id,
			profile_id: accounts.profile_id,
			platform: accounts.platform,
			platform_user_id: accounts.platform_user_id,
			access_token_encrypted: accounts.access_token_encrypted,
			refresh_token_encrypted: accounts.refresh_token_encrypted,
			user_id: profiles.user_id,
		})
		.from(accounts)
		.innerJoin(profiles, eq(accounts.profile_id, profiles.id))
		.where(and(eq(profiles.user_id, userId), eq(accounts.is_active, true)));

	if (userAccounts.length === 0) {
		return {
			result: ok({ status: "completed", succeeded: 0, failed: 0, total: 0, github_accounts: 0, reddit_accounts: 0 }),
			backgroundTasks: [],
		};
	}

	const { processAccount, gatherLatestSnapshots, combineUserTimeline } = await import("./cron");

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
				const snapshots = await gatherLatestSnapshots(ctx.backend, userAccounts);
				await combineUserTimeline(ctx.backend, userId, snapshots);
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
						.map_err((): RefreshError => ({ kind: "decryption_failed", message: "Failed to decrypt Reddit token" }))
						.result();

					if (!tokenResult.ok) {
						log.error("Reddit token decryption failed", { account_id: account.id });
						continue;
					}
					let token = tokenResult.value;

					const provider = new RedditProvider();
					let result = await processRedditAccount(ctx.backend, account.id, token, provider);

					if (!result.ok && result.error.original_kind === "auth_expired") {
						log.info("Reddit token expired, attempting refresh", { account_id: account.id });

						const refreshResult = await attemptRedditTokenRefresh(ctx, account);
						if (refreshResult.ok) {
							token = refreshResult.value;
							result = await processRedditAccount(ctx.backend, account.id, token, provider);
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
				const snapshots = await gatherLatestSnapshots(ctx.backend, userAccounts);
				await combineUserTimeline(ctx.backend, userId, snapshots);
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
		const snapshots = await gatherLatestSnapshots(ctx.backend, otherAccounts);
		await combineUserTimeline(ctx.backend, userId, snapshots);
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
