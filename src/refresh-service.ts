import { and, eq } from "drizzle-orm";
import { processRedditAccount } from "./cron-reddit";
import type { RefreshError } from "./errors";
import type { AppContext } from "./infrastructure";
import { createLogger } from "./logger";
import { RedditProvider } from "./platforms/reddit";
import { accountMembers, accounts } from "./schema";
import { type Result, decrypt, err, match, ok, pipe } from "./utils";

const log = createLogger("refresh");

type AccountWithUser = {
	id: string;
	platform: string;
	platform_user_id: string | null;
	access_token_encrypted: string;
	refresh_token_encrypted: string | null;
	is_active: boolean;
	user_id: string;
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

const lookupAccount = async (ctx: AppContext, accountId: string, userId: string): Promise<Result<AccountWithUser, RefreshError>> => {
	const row = await ctx.db
		.select({
			id: accounts.id,
			platform: accounts.platform,
			platform_user_id: accounts.platform_user_id,
			access_token_encrypted: accounts.access_token_encrypted,
			refresh_token_encrypted: accounts.refresh_token_encrypted,
			is_active: accounts.is_active,
			user_id: accountMembers.user_id,
		})
		.from(accounts)
		.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
		.where(and(eq(accountMembers.user_id, userId), eq(accounts.id, accountId)))
		.get();

	if (!row) {
		return err({ kind: "not_found", message: "Account not found" });
	}

	if (!row.is_active) {
		return err({ kind: "inactive", message: "Account is not active" });
	}

	return ok({
		id: row.id,
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
			platform: accounts.platform,
			platform_user_id: accounts.platform_user_id,
			access_token_encrypted: accounts.access_token_encrypted,
			refresh_token_encrypted: accounts.refresh_token_encrypted,
			user_id: accountMembers.user_id,
		})
		.from(accounts)
		.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
		.where(and(eq(accountMembers.user_id, userId), eq(accounts.is_active, true)));

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
	const token = tokenResult.value;

	const { gatherLatestSnapshots, combineUserTimeline } = await import("./cron");

	const backgroundTask: BackgroundTask = async () => {
		try {
			const provider = new RedditProvider();
			const result = await processRedditAccount(ctx.backend, account.id, token, provider);

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
			switch (account.platform) {
				case "github":
					return processGitHubRefresh(ctx, account, userId);
				case "reddit":
					return processRedditRefresh(ctx, account, userId);
				default:
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
			platform: accounts.platform,
			platform_user_id: accounts.platform_user_id,
			access_token_encrypted: accounts.access_token_encrypted,
			refresh_token_encrypted: accounts.refresh_token_encrypted,
			user_id: accountMembers.user_id,
		})
		.from(accounts)
		.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
		.where(and(eq(accountMembers.user_id, userId), eq(accounts.is_active, true)));

	if (userAccounts.length === 0) {
		return {
			result: ok({ status: "completed", succeeded: 0, failed: 0, total: 0, github_accounts: 0, reddit_accounts: 0 }),
			backgroundTasks: [],
		};
	}

	const { processAccount, gatherLatestSnapshots, combineUserTimeline } = await import("./cron");

	const githubAccounts = userAccounts.filter(a => a.platform === "github");
	const redditAccounts = userAccounts.filter(a => a.platform === "reddit");
	const otherAccounts = userAccounts.filter(a => a.platform !== "github" && a.platform !== "reddit");

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

			if (bgSucceeded > 0) {
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
					const token = tokenResult.value;

					const provider = new RedditProvider();
					const result = await processRedditAccount(ctx.backend, account.id, token, provider);
					if (result.ok) bgSucceeded++;
				} catch (e) {
					log.error("Reddit account refresh failed", { account_id: account.id, error: String(e) });
				}
			}

			if (bgSucceeded > 0) {
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

	if (succeeded > 0) {
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
