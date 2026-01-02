import type { Backend } from "@f0rbit/corpus";
import type { GitHubMetaStore, GitHubRepoCommitsStore, GitHubRepoPRsStore } from "@media/schema";
import type { FetchError, StoreError } from "./errors";
import { createLogger } from "./logger";
import { mergeByKey } from "./merge";
import type { GitHubFetchResult } from "./platforms/github";
import type { ProviderError } from "./platforms/types";
import { createGitHubCommitsStore, createGitHubMetaStore, createGitHubPRsStore } from "./storage";
import { type Result, err, ok, pipe, to_nullable } from "./utils";

const log = createLogger("cron:github");

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

type RepoStoreStats = { owner: string; repo: string; version: string; newCount: number; total: number };
const defaultRepoStats = (owner: string, repo: string): RepoStoreStats => ({ owner, repo, version: "", newCount: 0, total: 0 });

const storeMeta = async (backend: Backend, accountId: string, meta: GitHubMetaStore): Promise<string> => {
	const storeResult = createGitHubMetaStore(backend, accountId);
	if (!storeResult.ok) return "";

	const putResult = await storeResult.value.store.put(meta);
	return putResult.ok ? putResult.value.version : "";
};

const storeCommits = async (backend: Backend, accountId: string, owner: string, repo: string, incoming: GitHubRepoCommitsStore): Promise<RepoStoreStats> => {
	const storeResult = createGitHubCommitsStore(backend, accountId, owner, repo);
	if (!storeResult.ok) return defaultRepoStats(owner, repo);

	const store = storeResult.value.store;
	const existing = to_nullable(await store.get_latest())?.data ?? null;
	const { merged, newCount } = mergeCommits(existing, incoming);
	const putResult = await store.put(merged);

	return pipe(putResult)
		.map(({ version }) => ({ owner, repo, version, newCount, total: merged.total_commits }))
		.tap(({ newCount: n, total }) => log.debug("Stored commits", { owner, repo, new: n, total }))
		.unwrap_or(defaultRepoStats(owner, repo));
};

const storePRs = async (backend: Backend, accountId: string, owner: string, repo: string, incoming: GitHubRepoPRsStore): Promise<RepoStoreStats> => {
	const storeResult = createGitHubPRsStore(backend, accountId, owner, repo);
	if (!storeResult.ok) return defaultRepoStats(owner, repo);

	const store = storeResult.value.store;
	const existing = to_nullable(await store.get_latest())?.data ?? null;
	const { merged, newCount } = mergePRs(existing, incoming);
	const putResult = await store.put(merged);

	return pipe(putResult)
		.map(({ version }) => ({ owner, repo, version, newCount, total: merged.total_prs }))
		.tap(({ newCount: n, total }) => log.debug("Stored PRs", { owner, repo, new: n, total }))
		.unwrap_or(defaultRepoStats(owner, repo));
};

export async function processGitHubAccount(backend: Backend, accountId: string, token: string, provider: GitHubProvider): Promise<Result<GitHubProcessResult, GitHubProcessError>> {
	log.info("Processing account", { account_id: accountId });

	const fetchResult = await provider.fetch(token);
	if (!fetchResult.ok) {
		return err({
			kind: "fetch_failed",
			message: `GitHub fetch failed: ${fetchResult.error.kind}`,
		});
	}

	const { meta, repos } = fetchResult.value;

	const metaVersion = await storeMeta(backend, accountId, meta);

	const commitStores: Array<{ owner: string; repo: string; version: string }> = [];
	const prStores: Array<{ owner: string; repo: string; version: string }> = [];
	let totalCommits = 0;
	let totalPRs = 0;
	let newCommits = 0;
	let newPRs = 0;

	for (const [fullName, data] of repos) {
		const [owner, repo] = fullName.split("/");
		if (!owner || !repo) continue;

		const commitResult = await storeCommits(backend, accountId, owner, repo, data.commits);
		if (commitResult.version) {
			commitStores.push({ owner, repo, version: commitResult.version });
			totalCommits += commitResult.total;
			newCommits += commitResult.newCount;
		}

		const prResult = await storePRs(backend, accountId, owner, repo, data.prs);
		if (prResult.version) {
			prStores.push({ owner, repo, version: prResult.version });
			totalPRs += prResult.total;
			newPRs += prResult.newCount;
		}
	}

	log.info("Processing complete", {
		account_id: accountId,
		repos: repos.size,
		total_commits: totalCommits,
		new_commits: newCommits,
		total_prs: totalPRs,
		new_prs: newPRs,
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
