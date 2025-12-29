import type { Backend } from "@f0rbit/corpus";
import type { FetchError, StoreError } from "./errors";
import { mergeByKey } from "./merge";
import type { GitHubFetchResult } from "./platforms/github";
import type { ProviderError } from "./platforms/types";
import type { GitHubRepoCommitsStore, GitHubRepoPRsStore } from "./schema";
import { createGitHubCommitsStore, createGitHubMetaStore, createGitHubPRsStore } from "./storage";
import { type Result, err, ok, to_nullable } from "./utils";

export type GitHubProcessResult = {
	account_id: string;
	meta_version: string;
	commit_stores: Array<{ owner: string; repo: string; version: string }>;
	pr_stores: Array<{ owner: string; repo: string; version: string }>;
	stats: {
		repos_processed: number;
		total_commits: number;
		total_prs: number;
		new_commits: number;
		new_prs: number;
	};
};

type GitHubProcessError = FetchError | StoreError;

const mergeCommits = (existing: GitHubRepoCommitsStore | null, incoming: GitHubRepoCommitsStore): { merged: GitHubRepoCommitsStore; newCount: number } => {
	const { merged: commits, newCount } = mergeByKey(existing?.commits, incoming.commits, c => c.sha);

	return {
		merged: {
			owner: incoming.owner,
			repo: incoming.repo,
			branches: [...new Set([...(existing?.branches ?? []), ...incoming.branches])],
			commits,
			total_commits: commits.length,
			fetched_at: incoming.fetched_at,
		},
		newCount,
	};
};

const mergePRs = (existing: GitHubRepoPRsStore | null, incoming: GitHubRepoPRsStore): { merged: GitHubRepoPRsStore; newCount: number } => {
	const { merged: pull_requests, newCount } = mergeByKey(existing?.pull_requests, incoming.pull_requests, pr => String(pr.number));

	return {
		merged: {
			owner: incoming.owner,
			repo: incoming.repo,
			pull_requests,
			total_prs: pull_requests.length,
			fetched_at: incoming.fetched_at,
		},
		newCount,
	};
};

type GitHubProvider = {
	fetch(token: string): Promise<Result<GitHubFetchResult, ProviderError>>;
};

export async function processGitHubAccount(backend: Backend, accountId: string, token: string, provider: GitHubProvider): Promise<Result<GitHubProcessResult, GitHubProcessError>> {
	console.log(`[processGitHubAccount] Starting for account: ${accountId}`);

	const fetchResult = await provider.fetch(token);
	if (!fetchResult.ok) {
		return err({
			kind: "fetch_failed",
			message: `GitHub fetch failed: ${fetchResult.error.kind}`,
		});
	}

	const { meta, repos } = fetchResult.value;

	let metaVersion = "";
	const metaStoreResult = createGitHubMetaStore(backend, accountId);
	if (metaStoreResult.ok) {
		const putResult = await metaStoreResult.value.store.put(meta);
		if (putResult.ok) {
			metaVersion = putResult.value.version;
		}
	}

	const commitStores: Array<{ owner: string; repo: string; version: string }> = [];
	const prStores: Array<{ owner: string; repo: string; version: string }> = [];
	let totalCommits = 0;
	let totalPRs = 0;
	let newCommits = 0;
	let newPRs = 0;

	for (const [fullName, data] of repos) {
		const [owner, repo] = fullName.split("/");
		if (!owner || !repo) continue;

		const commitsStoreResult = createGitHubCommitsStore(backend, accountId, owner, repo);
		if (commitsStoreResult.ok) {
			const store = commitsStoreResult.value.store;

			const existingResult = await store.get_latest();
			const existing = to_nullable(existingResult)?.data ?? null;

			const { merged: mergedCommits, newCount: commitNewCount } = mergeCommits(existing, data.commits);
			newCommits += commitNewCount;

			const putResult = await store.put(mergedCommits);
			if (putResult.ok) {
				commitStores.push({ owner, repo, version: putResult.value.version });
				totalCommits += mergedCommits.total_commits;
			}

			console.log(`[processGitHubAccount] ${fullName} commits: ${commitNewCount} new, ${mergedCommits.total_commits} total`);
		}

		const prsStoreResult = createGitHubPRsStore(backend, accountId, owner, repo);
		if (prsStoreResult.ok) {
			const store = prsStoreResult.value.store;

			const existingResult = await store.get_latest();
			const existing = to_nullable(existingResult)?.data ?? null;

			const { merged: mergedPRs, newCount: prNewCount } = mergePRs(existing, data.prs);
			newPRs += prNewCount;

			const putResult = await store.put(mergedPRs);
			if (putResult.ok) {
				prStores.push({ owner, repo, version: putResult.value.version });
				totalPRs += mergedPRs.total_prs;
			}

			console.log(`[processGitHubAccount] ${fullName} PRs: ${prNewCount} new, ${mergedPRs.total_prs} total`);
		}
	}

	console.log("[processGitHubAccount] Completed:", {
		repos: repos.size,
		commitStores: commitStores.length,
		prStores: prStores.length,
		totalCommits,
		totalPRs,
		newCommits,
		newPRs,
	});

	return ok({
		account_id: accountId,
		meta_version: metaVersion,
		commit_stores: commitStores,
		pr_stores: prStores,
		stats: {
			repos_processed: repos.size,
			total_commits: totalCommits,
			total_prs: totalPRs,
			new_commits: newCommits,
			new_prs: newPRs,
		},
	});
}
