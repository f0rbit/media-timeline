import type { AppContext } from "../infrastructure/context";
import { createLogger } from "../logger";
import { GitHubProvider } from "../platforms";
import { RedditProvider } from "../platforms/reddit";
import { TwitterProvider } from "../platforms/twitter";
import type { ProviderFactory } from "../platforms/types";
import { type AccountWithUser, fetchAllActiveAccounts } from "../services/connections";
import {
	type PlatformGroups,
	type RawSnapshot,
	combineUserTimeline,
	gatherLatestSnapshots,
	generateTimeline,
	groupSnapshotsByPlatform,
	loadPlatformItems,
	normalizeOtherSnapshots,
	processAccount,
	regenerateTimelinesForUsers,
	shouldFetchForPlatform,
	storeTimeline,
} from "../sync";
import { processGitHubAccount } from "./processors/github";
import { processRedditAccount } from "./processors/reddit";
import { processTwitterAccount } from "./processors/twitter";
import type { CronResult } from "./types";

export { type ProcessResult, type StoreStats, type MergeResult, type StoreConfig, type ProcessError, type PlatformProvider, defaultStats, storeWithMerge, storeMeta, createMerger, formatFetchError } from "./platform-processor";
export { processGitHubAccount, type GitHubProcessResult } from "./processors/github";
export { processRedditAccount, type RedditProcessResult } from "./processors/reddit";
export { processTwitterAccount, type TwitterProcessResult } from "./processors/twitter";
export type { CronResult, RawSnapshot, PlatformGroups } from "./types";
export type { ProviderFactory };

export { combineUserTimeline, gatherLatestSnapshots, generateTimeline, groupSnapshotsByPlatform, loadPlatformItems, normalizeOtherSnapshots, processAccount, storeTimeline };

const log = createLogger("cron");

const groupAccountsByUser = (accountsWithUsers: AccountWithUser[]): Map<string, AccountWithUser[]> => {
	const userAccounts = new Map<string, AccountWithUser[]>();
	for (const account of accountsWithUsers) {
		const existing = userAccounts.get(account.user_id) ?? [];
		existing.push(account);
		userAccounts.set(account.user_id, existing);
	}
	return userAccounts;
};

const processAccountBatch = async (ctx: AppContext, userAccountsList: AccountWithUser[], result: CronResult): Promise<boolean> => {
	const results = await Promise.allSettled(
		userAccountsList.map(async account => {
			result.processed_accounts++;
			const snapshot = await processAccount(ctx, account);
			return snapshot !== null;
		})
	);

	let hasUpdates = false;
	for (const res of results) {
		if (res.status === "rejected") {
			log.error("Account processing failed", { reason: String(res.reason) });
		} else if (res.value) {
			hasUpdates = true;
		}
	}

	return hasUpdates;
};

export async function handleCron(ctx: AppContext): Promise<CronResult> {
	log.info("Cron job starting");

	const result: CronResult = {
		processed_accounts: 0,
		updated_users: [],
		failed_accounts: [],
		timelines_generated: 0,
	};

	const accountsWithUsers = await fetchAllActiveAccounts(ctx.db);
	const userAccounts = groupAccountsByUser(accountsWithUsers);

	log.info("Processing accounts", { total: accountsWithUsers.length, users: userAccounts.size });

	const updatedUsers = new Set<string>();

	for (const [userId, userAccountsList] of userAccounts) {
		const hasUpdates = await processAccountBatch(ctx, userAccountsList, result);
		if (hasUpdates) {
			updatedUsers.add(userId);
		}
	}

	result.timelines_generated = await regenerateTimelinesForUsers(ctx.backend, updatedUsers, userAccounts);
	result.updated_users = Array.from(updatedUsers);

	log.info("Cron job completed", {
		processed: result.processed_accounts,
		timelines: result.timelines_generated,
		updated_users: result.updated_users.length,
		failed: result.failed_accounts.length,
	});

	return result;
}
