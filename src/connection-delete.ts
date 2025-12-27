import type { Backend } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import type { Database } from "./db";
import { accountMembers, accounts, accountSettings, rateLimits } from "./schema/database";
import type { Platform } from "./schema";
import { createGitHubMetaStore, createGitHubCommitsStore, createGitHubPRsStore, listGitHubCommitStores, listGitHubPRStores, createRawStore, githubMetaStoreId } from "./storage";
import { ok, err, type Result } from "./utils";

export type DeleteConnectionResult = {
	account_id: string;
	platform: string;
	deleted_stores: string[];
	affected_users: string[];
};

export type DeleteConnectionError = { kind: "not_found" } | { kind: "forbidden"; message: string } | { kind: "database_error"; message: string };

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

const deleteStoreSnapshots = async (backend: Backend, storeId: string): Promise<boolean> => {
	log("store", `Deleting snapshots for store: ${storeId}`);

	const storeResult =
		storeId.startsWith("github/") && storeId.endsWith("/meta")
			? createGitHubMetaStore(backend, storeId.split("/")[1]!)
			: storeId.includes("/commits/")
				? (() => {
						const parts = storeId.split("/");
						return createGitHubCommitsStore(backend, parts[1]!, parts[3]!, parts[4]!);
					})()
				: storeId.includes("/prs/")
					? (() => {
							const parts = storeId.split("/");
							return createGitHubPRsStore(backend, parts[1]!, parts[3]!, parts[4]!);
						})()
					: storeId.startsWith("raw/")
						? (() => {
								const parts = storeId.split("/");
								return createRawStore(backend, parts[1]!, parts[2]!);
							})()
						: null;

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

	return deleteRawStore(backend, account.platform, account.id);
};

const getAffectedUsers = async (db: Database, accountId: string): Promise<string[]> => {
	const members = await db.select({ user_id: accountMembers.user_id }).from(accountMembers).where(eq(accountMembers.account_id, accountId));

	return members.map(m => m.user_id);
};

const deleteDbRecords = async (db: Database, accountId: string): Promise<Result<void, DeleteConnectionError>> => {
	log("db", "Deleting rate_limits", { accountId });
	try {
		await db.delete(rateLimits).where(eq(rateLimits.account_id, accountId));
	} catch (e) {
		log("db", "Failed to delete rate_limits", { error: String(e) });
		return err({ kind: "database_error", message: `Failed to delete rate_limits: ${String(e)}` });
	}

	log("db", "Deleting account_settings", { accountId });
	try {
		await db.delete(accountSettings).where(eq(accountSettings.account_id, accountId));
	} catch (e) {
		log("db", "Failed to delete account_settings", { error: String(e) });
		return err({ kind: "database_error", message: `Failed to delete account_settings: ${String(e)}` });
	}

	log("db", "Deleting account_members", { accountId });
	try {
		await db.delete(accountMembers).where(eq(accountMembers.account_id, accountId));
	} catch (e) {
		log("db", "Failed to delete account_members", { error: String(e) });
		return err({ kind: "database_error", message: `Failed to delete account_members: ${String(e)}` });
	}

	log("db", "Deleting account", { accountId });
	try {
		await db.delete(accounts).where(eq(accounts.id, accountId));
	} catch (e) {
		log("db", "Failed to delete account", { error: String(e) });
		return err({ kind: "database_error", message: `Failed to delete account: ${String(e)}` });
	}

	log("db", "All database records deleted", { accountId });
	return ok(undefined);
};

export async function deleteConnection(ctx: DeleteContext, accountId: string, requestingUserId: string): Promise<Result<DeleteConnectionResult, DeleteConnectionError>> {
	log("start", "Beginning connection deletion", { accountId, requestingUserId });

	const members = await ctx.db.select({ role: accountMembers.role, user_id: accountMembers.user_id }).from(accountMembers).where(eq(accountMembers.account_id, accountId)).all();

	const requestingUserMembership = members.find(m => m.user_id === requestingUserId);

	if (!requestingUserMembership) {
		log("auth", "Account not found for user", { accountId, requestingUserId });
		return err({ kind: "not_found" });
	}

	if (requestingUserMembership.role !== "owner") {
		log("auth", "User is not owner", { accountId, requestingUserId, role: requestingUserMembership.role });
		return err({ kind: "forbidden", message: "Only owners can delete accounts" });
	}

	log("auth", "Authorization check passed", { accountId, requestingUserId });

	const account = await ctx.db.select().from(accounts).where(eq(accounts.id, accountId)).get();

	if (!account) {
		log("fetch", "Account not found in database", { accountId });
		return err({ kind: "not_found" });
	}

	log("fetch", "Account found", { accountId, platform: account.platform });

	const affectedUsers = await getAffectedUsers(ctx.db, accountId);
	log("users", "Found affected users", { count: affectedUsers.length, users: affectedUsers });

	const deletedStores = await deleteCorpusStores(ctx.backend, {
		id: account.id,
		platform: account.platform,
	});
	log("corpus", "Corpus stores deleted", { count: deletedStores.length, stores: deletedStores });

	const dbResult = await deleteDbRecords(ctx.db, accountId);
	if (!dbResult.ok) {
		return dbResult;
	}

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
}
