import type { Backend } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import type { Database } from "./db";
import type { ConnectionError } from "./errors";
import type { Platform } from "./schema";
import { accountMembers, accountSettings, accounts, rateLimits } from "./schema/database";
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

export type DeleteConnectionResult = {
	account_id: string;
	platform: string;
	deleted_stores: string[];
	affected_users: string[];
};

export type DeleteConnectionError = ConnectionError;

type DeleteContext = {
	db: Database;
	backend: Backend;
};

type AccountInfo = {
	id: string;
	platform: Platform;
};

const log = (step: string, message: string, data?: Record<string, unknown>) => {
	console.log(`[delete-connection:${step}]`, message, data ? JSON.stringify(data) : "");
};

const resolveStoreFromId = (backend: Backend, storeId: string) => {
	const parsed = parseStoreId(storeId);
	if (!parsed.ok) return null;

	switch (parsed.value.type) {
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
	}
};

const deleteStoreSnapshots = async (backend: Backend, storeId: string): Promise<boolean> => {
	log("store", `Deleting snapshots for store: ${storeId}`);

	const storeResult = resolveStoreFromId(backend, storeId);

	if (!storeResult || !storeResult.ok) {
		log("store", `Store not found: ${storeId}`);
		return false;
	}

	const store = storeResult.value.store;
	let deletedCount = 0;

	for await (const snapshot of store.list()) {
		const deleteResult = await store.delete(snapshot.version);
		if (deleteResult.ok) {
			deletedCount++;
		} else {
			log("store", `Failed to delete snapshot ${snapshot.version}`, { error: deleteResult.error });
		}
	}

	log("store", `Deleted ${deletedCount} snapshots from ${storeId}`);
	return deletedCount > 0;
};

const deleteGitHubStores = async (backend: Backend, accountId: string): Promise<string[]> => {
	const deletedStores: string[] = [];

	log("github", "Listing commit stores for account", { accountId });
	const commitStores = await listGitHubCommitStores(backend, accountId);
	log("github", `Found ${commitStores.length} commit stores`);

	for (const { storeId } of commitStores) {
		const deleted = await deleteStoreSnapshots(backend, storeId);
		if (deleted) deletedStores.push(storeId);
	}

	log("github", "Listing PR stores for account", { accountId });
	const prStores = await listGitHubPRStores(backend, accountId);
	log("github", `Found ${prStores.length} PR stores`);

	for (const { storeId } of prStores) {
		const deleted = await deleteStoreSnapshots(backend, storeId);
		if (deleted) deletedStores.push(storeId);
	}

	const metaStoreId = githubMetaStoreId(accountId);
	log("github", "Deleting meta store", { storeId: metaStoreId });
	const metaDeleted = await deleteStoreSnapshots(backend, metaStoreId);
	if (metaDeleted) deletedStores.push(metaStoreId);

	return deletedStores;
};

const deleteRedditStores = async (backend: Backend, accountId: string): Promise<string[]> => {
	const deletedStores: string[] = [];

	const metaStoreId = redditMetaStoreId(accountId);
	log("reddit", "Deleting meta store", { storeId: metaStoreId });
	const metaDeleted = await deleteStoreSnapshots(backend, metaStoreId);
	if (metaDeleted) deletedStores.push(metaStoreId);

	const postsStoreId = redditPostsStoreId(accountId);
	log("reddit", "Deleting posts store", { storeId: postsStoreId });
	const postsDeleted = await deleteStoreSnapshots(backend, postsStoreId);
	if (postsDeleted) deletedStores.push(postsStoreId);

	const commentsStoreId = redditCommentsStoreId(accountId);
	log("reddit", "Deleting comments store", { storeId: commentsStoreId });
	const commentsDeleted = await deleteStoreSnapshots(backend, commentsStoreId);
	if (commentsDeleted) deletedStores.push(commentsStoreId);

	return deletedStores;
};

const deleteRawStore = async (backend: Backend, platform: string, accountId: string): Promise<string[]> => {
	const storeId = `raw/${platform}/${accountId}`;
	log("raw", "Deleting raw store", { storeId });
	const deleted = await deleteStoreSnapshots(backend, storeId);
	return deleted ? [storeId] : [];
};

const deleteCorpusStores = async (backend: Backend, account: AccountInfo): Promise<string[]> => {
	log("corpus", "Deleting corpus stores", { platform: account.platform, accountId: account.id });

	if (account.platform === "github") {
		return deleteGitHubStores(backend, account.id);
	}

	if (account.platform === "reddit") {
		return deleteRedditStores(backend, account.id);
	}

	return deleteRawStore(backend, account.platform, account.id);
};

const getAffectedUsers = async (db: Database, accountId: string): Promise<string[]> => {
	const members = await db.select({ user_id: accountMembers.user_id }).from(accountMembers).where(eq(accountMembers.account_id, accountId));

	return members.map(m => m.user_id);
};

type TableDeletion = {
	name: string;
	execute: () => Promise<unknown>;
};

const deleteTable = async (deletion: TableDeletion, accountId: string): Promise<Result<void, DeleteConnectionError>> => {
	log("db", `Deleting ${deletion.name}`, { accountId });
	return try_catch_async(
		async () => {
			await deletion.execute();
		},
		(e): DeleteConnectionError => {
			log("db", `Failed to delete ${deletion.name}`, { error: String(e) });
			return { kind: "database_error", message: `Failed to delete ${deletion.name}: ${String(e)}` };
		}
	);
};

const deleteDbRecords = async (db: Database, accountId: string): Promise<Result<void, DeleteConnectionError>> => {
	const deletions: TableDeletion[] = [
		{ name: "rate_limits", execute: () => db.delete(rateLimits).where(eq(rateLimits.account_id, accountId)) },
		{ name: "account_settings", execute: () => db.delete(accountSettings).where(eq(accountSettings.account_id, accountId)) },
		{ name: "account_members", execute: () => db.delete(accountMembers).where(eq(accountMembers.account_id, accountId)) },
		{ name: "account", execute: () => db.delete(accounts).where(eq(accounts.id, accountId)) },
	];

	for (const deletion of deletions) {
		const result = await deleteTable(deletion, accountId);
		if (!result.ok) return result;
	}

	log("db", "All database records deleted", { accountId });
	return ok(undefined);
};

type Member = { role: string; user_id: string };

const validateOwnership = (members: Member[], requestingUserId: string, accountId: string): Result<Member, DeleteConnectionError> => {
	const membership = members.find(m => m.user_id === requestingUserId);
	if (!membership) {
		log("auth", "Account not found for user", { accountId, requestingUserId });
		return err({ kind: "not_found" });
	}
	if (membership.role !== "owner") {
		log("auth", "User is not owner", { accountId, requestingUserId, role: membership.role });
		return err({ kind: "forbidden", message: "Only owners can delete accounts" });
	}
	log("auth", "Authorization check passed", { accountId, requestingUserId });
	return ok(membership);
};

type Account = { id: string; platform: Platform };

const fetchAccount = async (db: Database, accountId: string): Promise<Result<Account, DeleteConnectionError>> => {
	const account = await db.select().from(accounts).where(eq(accounts.id, accountId)).get();
	if (!account) {
		log("fetch", "Account not found in database", { accountId });
		return err({ kind: "not_found" });
	}
	log("fetch", "Account found", { accountId, platform: account.platform });
	return ok(account);
};

type DeletionContext = {
	account: Account;
	affectedUsers: string[];
	deletedStores: string[];
};

export async function deleteConnection(ctx: DeleteContext, accountId: string, requestingUserId: string): Promise<Result<DeleteConnectionResult, DeleteConnectionError>> {
	log("start", "Beginning connection deletion", { accountId, requestingUserId });

	const members = await ctx.db.select({ role: accountMembers.role, user_id: accountMembers.user_id }).from(accountMembers).where(eq(accountMembers.account_id, accountId)).all();

	return pipe(validateOwnership(members, requestingUserId, accountId))
		.flat_map(() => fetchAccount(ctx.db, accountId))
		.flat_map(async (account): Promise<Result<DeletionContext, DeleteConnectionError>> => {
			const affectedUsers = await getAffectedUsers(ctx.db, accountId);
			log("users", "Found affected users", { count: affectedUsers.length, users: affectedUsers });

			const deletedStores = await deleteCorpusStores(ctx.backend, { id: account.id, platform: account.platform });
			log("corpus", "Corpus stores deleted", { count: deletedStores.length, stores: deletedStores });

			return ok({ account, affectedUsers, deletedStores });
		})
		.flat_map(async ({ account, affectedUsers, deletedStores }): Promise<Result<DeleteConnectionResult, DeleteConnectionError>> => {
			const dbResult = await deleteDbRecords(ctx.db, accountId);
			if (!dbResult.ok) return dbResult;

			log("complete", "Connection deletion completed", {
				accountId,
				platform: account.platform,
				deletedStores: deletedStores.length,
				affectedUsers: affectedUsers.length,
			});

			return ok({
				account_id: accountId,
				platform: account.platform,
				deleted_stores: deletedStores,
				affected_users: affectedUsers,
			});
		})
		.result();
}
