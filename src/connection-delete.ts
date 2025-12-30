import type { Backend } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import type { Database } from "./db";
import type { ConnectionError } from "./errors";
import { createLogger } from "./logger";
import type { AccountId, Platform, UserId } from "./schema";
import { accountSettings, accounts, profiles, rateLimits } from "./schema/database";
import {
	createGitHubCommitsStore,
	createGitHubMetaStore,
	createGitHubPRsStore,
	createRawStore,
	createRedditCommentsStore,
	createRedditMetaStore,
	createRedditPostsStore,
	createTwitterMetaStore,
	createTwitterTweetsStore,
	githubMetaStoreId,
	listGitHubCommitStores,
	listGitHubPRStores,
	parseStoreId,
	redditCommentsStoreId,
	redditMetaStoreId,
	redditPostsStoreId,
} from "./storage";
import { type Result, err, ok, pipe, try_catch_async } from "./utils";

const log = createLogger("connection:delete");

export type DeleteConnectionResult = {
	account_id: string;
	platform: string;
	deleted_stores: string[];
	affected_users: string[];
};

export type DeleteConnectionError = ConnectionError;

export type DeletionAttempt = {
	success: boolean;
	version?: string;
	error?: string;
};

export type StoreType = "github_meta" | "github_commits" | "github_prs" | "reddit_meta" | "reddit_posts" | "reddit_comments" | "twitter_meta" | "twitter_tweets" | "bluesky" | "youtube" | "devpad" | "raw";

const VALID_STORE_TYPES: StoreType[] = ["github_meta", "github_commits", "github_prs", "reddit_meta", "reddit_posts", "reddit_comments", "twitter_meta", "twitter_tweets", "bluesky", "youtube", "devpad", "raw"];

export const isValidStoreType = (type: string): type is StoreType => VALID_STORE_TYPES.includes(type as StoreType);

export const validateAccountOwnership = <T extends { user_id: string }>(account: T | null, requestingUserId: string): Result<T, DeleteConnectionError> => {
	if (!account) return err({ kind: "not_found" });
	if (account.user_id !== requestingUserId) {
		return err({ kind: "forbidden", message: "You do not own this account" });
	}
	return ok(account);
};

export const summarizeDeletions = (attempts: DeletionAttempt[]): { deleted: number; failed: number } =>
	attempts.reduce(
		(acc, a) => ({
			deleted: acc.deleted + (a.success ? 1 : 0),
			failed: acc.failed + (a.success ? 0 : 1),
		}),
		{ deleted: 0, failed: 0 }
	);

type DeleteContext = {
	db: Database;
	backend: Backend;
};

type AccountInfo = {
	id: string;
	platform: Platform;
};

const resolveStoreFromId = (backend: Backend, storeId: string) => {
	const parsed = parseStoreId(storeId);
	if (!parsed.ok) return null;

	const storeType = parsed.value.type;
	switch (storeType) {
		case "github_meta":
			return createGitHubMetaStore(backend, parsed.value.accountId);
		case "github_commits":
			return createGitHubCommitsStore(backend, parsed.value.accountId, parsed.value.owner, parsed.value.repo);
		case "github_prs":
			return createGitHubPRsStore(backend, parsed.value.accountId, parsed.value.owner, parsed.value.repo);
		case "reddit_meta":
			return createRedditMetaStore(backend, parsed.value.accountId);
		case "reddit_posts":
			return createRedditPostsStore(backend, parsed.value.accountId);
		case "reddit_comments":
			return createRedditCommentsStore(backend, parsed.value.accountId);
		case "twitter_meta":
			return createTwitterMetaStore(backend, parsed.value.accountId);
		case "twitter_tweets":
			return createTwitterTweetsStore(backend, parsed.value.accountId);
		case "raw":
			return createRawStore(backend, parsed.value.platform, parsed.value.accountId);
		default: {
			const _exhaustiveCheck: never = storeType;
			return null;
		}
	}
};

const deleteStoreSnapshots = async (backend: Backend, storeId: string): Promise<boolean> => {
	log.info("Deleting snapshots for store", { step: "store", storeId });

	const storeResult = resolveStoreFromId(backend, storeId);

	if (!storeResult || !storeResult.ok) {
		log.info("Store not found", { step: "store", storeId });
		return false;
	}

	const store = storeResult.value.store;
	let deletedCount = 0;

	for await (const snapshot of store.list()) {
		const deleteResult = await store.delete(snapshot.version);
		if (deleteResult.ok) {
			deletedCount++;
		} else {
			log.warn("Failed to delete snapshot", { step: "store", version: snapshot.version, error: deleteResult.error });
		}
	}

	log.info("Deleted snapshots", { step: "store", deletedCount, storeId });
	return deletedCount > 0;
};

const deleteGitHubStores = async (backend: Backend, accountId: string): Promise<string[]> => {
	const deletedStores: string[] = [];

	log.info("Listing commit stores for account", { step: "github", accountId });
	const commitStores = await listGitHubCommitStores(backend, accountId);
	log.info("Found commit stores", { step: "github", count: commitStores.length });

	for (const { storeId } of commitStores) {
		const deleted = await deleteStoreSnapshots(backend, storeId);
		if (deleted) deletedStores.push(storeId);
	}

	log.info("Listing PR stores for account", { step: "github", accountId });
	const prStores = await listGitHubPRStores(backend, accountId);
	log.info("Found PR stores", { step: "github", count: prStores.length });

	for (const { storeId } of prStores) {
		const deleted = await deleteStoreSnapshots(backend, storeId);
		if (deleted) deletedStores.push(storeId);
	}

	const metaStoreId = githubMetaStoreId(accountId);
	log.info("Deleting meta store", { step: "github", storeId: metaStoreId });
	const metaDeleted = await deleteStoreSnapshots(backend, metaStoreId);
	if (metaDeleted) deletedStores.push(metaStoreId);

	return deletedStores;
};

const deleteRedditStores = async (backend: Backend, accountId: string): Promise<string[]> => {
	const deletedStores: string[] = [];

	const metaStoreId = redditMetaStoreId(accountId);
	log.info("Deleting meta store", { step: "reddit", storeId: metaStoreId });
	const metaDeleted = await deleteStoreSnapshots(backend, metaStoreId);
	if (metaDeleted) deletedStores.push(metaStoreId);

	const postsStoreId = redditPostsStoreId(accountId);
	log.info("Deleting posts store", { step: "reddit", storeId: postsStoreId });
	const postsDeleted = await deleteStoreSnapshots(backend, postsStoreId);
	if (postsDeleted) deletedStores.push(postsStoreId);

	const commentsStoreId = redditCommentsStoreId(accountId);
	log.info("Deleting comments store", { step: "reddit", storeId: commentsStoreId });
	const commentsDeleted = await deleteStoreSnapshots(backend, commentsStoreId);
	if (commentsDeleted) deletedStores.push(commentsStoreId);

	return deletedStores;
};

const deleteRawStore = async (backend: Backend, platform: string, accountId: string): Promise<string[]> => {
	const storeId = `raw/${platform}/${accountId}`;
	log.info("Deleting raw store", { step: "raw", storeId });
	const deleted = await deleteStoreSnapshots(backend, storeId);
	return deleted ? [storeId] : [];
};

const deleteCorpusStores = async (backend: Backend, account: AccountInfo): Promise<string[]> => {
	log.info("Deleting corpus stores", { step: "corpus", platform: account.platform, accountId: account.id });

	if (account.platform === "github") {
		return deleteGitHubStores(backend, account.id);
	}

	if (account.platform === "reddit") {
		return deleteRedditStores(backend, account.id);
	}

	return deleteRawStore(backend, account.platform, account.id);
};

const getAffectedUsers = async (db: Database, accountId: string): Promise<string[]> => {
	const account = await db.select({ user_id: profiles.user_id }).from(accounts).innerJoin(profiles, eq(accounts.profile_id, profiles.id)).where(eq(accounts.id, accountId)).get();

	return account ? [account.user_id] : [];
};

type TableDeletion = {
	name: string;
	execute: () => Promise<unknown>;
};

const deleteTable = async (deletion: TableDeletion, accountId: string): Promise<Result<void, DeleteConnectionError>> => {
	log.info("Deleting table", { step: "db", table: deletion.name, accountId });
	return try_catch_async(
		async () => {
			await deletion.execute();
		},
		(e): DeleteConnectionError => {
			log.error("Failed to delete table", { step: "db", table: deletion.name, error: String(e) });
			return { kind: "database_error", message: `Failed to delete ${deletion.name}: ${String(e)}` };
		}
	);
};

const deleteDbRecords = async (db: Database, accountId: string): Promise<Result<void, DeleteConnectionError>> => {
	const deletions: TableDeletion[] = [
		{ name: "rate_limits", execute: () => db.delete(rateLimits).where(eq(rateLimits.account_id, accountId)) },
		{ name: "account_settings", execute: () => db.delete(accountSettings).where(eq(accountSettings.account_id, accountId)) },
		{ name: "account", execute: () => db.delete(accounts).where(eq(accounts.id, accountId)) },
	];

	for (const deletion of deletions) {
		const result = await deleteTable(deletion, accountId);
		if (!result.ok) return result;
	}

	log.info("All database records deleted", { step: "db", accountId });
	return ok(undefined);
};

type AccountWithOwner = { id: string; platform: Platform; user_id: string };

const validateOwnership = (account: AccountWithOwner | null, requestingUserId: string, accountId: string): Result<AccountWithOwner, DeleteConnectionError> => {
	const result = validateAccountOwnership(account, requestingUserId);
	if (!result.ok) {
		const logData = result.error.kind === "not_found" ? { accountId, requestingUserId } : { accountId, requestingUserId, owner: account?.user_id };
		log.warn(result.error.kind === "not_found" ? "Account not found" : "User does not own account", { step: "auth", ...logData });
		return result;
	}
	log.info("Authorization check passed", { step: "auth", accountId, requestingUserId });
	return result;
};

const fetchAccountWithOwner = async (db: Database, accountId: string): Promise<AccountWithOwner | null> => {
	const result = await db
		.select({
			id: accounts.id,
			platform: accounts.platform,
			user_id: profiles.user_id,
		})
		.from(accounts)
		.innerJoin(profiles, eq(accounts.profile_id, profiles.id))
		.where(eq(accounts.id, accountId))
		.get();
	return result ?? null;
};

type DeletionContext = {
	account: AccountWithOwner;
	affectedUsers: string[];
	deletedStores: string[];
};

export async function deleteConnection(ctx: DeleteContext, accId: AccountId, requestingUserId: UserId): Promise<Result<DeleteConnectionResult, DeleteConnectionError>> {
	log.info("Beginning connection deletion", { step: "start", accountId: accId, requestingUserId });

	const account = await fetchAccountWithOwner(ctx.db, accId);

	return pipe(validateOwnership(account, requestingUserId, accId))
		.flat_map(async (validatedAccount): Promise<Result<DeletionContext, DeleteConnectionError>> => {
			const affectedUsers = await getAffectedUsers(ctx.db, accId);
			log.info("Found affected users", { step: "users", count: affectedUsers.length, users: affectedUsers });

			const deletedStores = await deleteCorpusStores(ctx.backend, { id: validatedAccount.id, platform: validatedAccount.platform });
			log.info("Corpus stores deleted", { step: "corpus", count: deletedStores.length, stores: deletedStores });

			return ok({ account: validatedAccount, affectedUsers, deletedStores });
		})
		.flat_map(async ({ account, affectedUsers, deletedStores }): Promise<Result<DeleteConnectionResult, DeleteConnectionError>> => {
			const dbResult = await deleteDbRecords(ctx.db, accId);
			if (!dbResult.ok) return dbResult;

			log.info("Connection deletion completed", {
				step: "complete",
				accountId: accId,
				platform: account.platform,
				deletedStores: deletedStores.length,
				affectedUsers: affectedUsers.length,
			});

			return ok({
				account_id: accId,
				platform: account.platform,
				deleted_stores: deletedStores,
				affected_users: affectedUsers,
			});
		})
		.result();
}
