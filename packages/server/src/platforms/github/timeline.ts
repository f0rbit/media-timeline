import type { Backend } from "@f0rbit/corpus";
import type { GitHubRepoCommit, GitHubRepoPR, TimelineItem } from "@media/schema";
import { createLogger } from "../../logger";
import { createGitHubCommitsStore, createGitHubPRsStore, listGitHubCommitStores, listGitHubPRStores } from "../../storage";
import { truncate } from "../../utils";

const log = createLogger("platforms:github:timeline");

export type CommitWithRepo = GitHubRepoCommit & { _repo: string };
export type PRWithRepo = GitHubRepoPR & { _repo: string };

export type GitHubTimelineData = {
	commits: CommitWithRepo[];
	prs: PRWithRepo[];
};

export const loadGitHubData = async (backend: Backend, accountId: string): Promise<GitHubTimelineData> => {
	const commits: CommitWithRepo[] = [];
	const prs: PRWithRepo[] = [];

	const commitStores = await listGitHubCommitStores(backend, accountId);

	await Promise.all(
		commitStores.map(async ({ owner, repo }) => {
			const storeResult = createGitHubCommitsStore(backend, accountId, owner, repo);
			if (!storeResult.ok) return;

			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok || !snapshotResult.value) return;

			const fullName = `${owner}/${repo}`;
			for (const commit of snapshotResult.value.data.commits) {
				commits.push({ ...commit, _repo: fullName });
			}
		})
	);

	const prStores = await listGitHubPRStores(backend, accountId);

	await Promise.all(
		prStores.map(async ({ owner, repo }) => {
			const storeResult = createGitHubPRsStore(backend, accountId, owner, repo);
			if (!storeResult.ok) return;

			const snapshotResult = await storeResult.value.store.get_latest();
			if (!snapshotResult.ok || !snapshotResult.value) return;

			const fullName = `${owner}/${repo}`;
			for (const pr of snapshotResult.value.data.pull_requests) {
				prs.push({ ...pr, _repo: fullName });
			}
		})
	);

	log.info("Loaded GitHub data", { account_id: accountId, commits: commits.length, prs: prs.length });
	return { commits, prs };
};

export const normalizeGitHub = (data: GitHubTimelineData): TimelineItem[] => {
	const items: TimelineItem[] = [];

	for (const commit of data.commits) {
		items.push({
			id: `github:commit:${commit._repo}:${commit.sha.slice(0, 7)}`,
			platform: "github",
			type: "commit",
			timestamp: commit.author_date,
			title: truncate(commit.message),
			url: commit.url,
			payload: {
				type: "commit",
				sha: commit.sha,
				message: commit.message,
				repo: commit._repo,
				branch: commit.branch,
				additions: commit.additions,
				deletions: commit.deletions,
				files_changed: commit.files_changed,
			},
		});
	}

	log.debug("Normalized GitHub commits", { count: data.commits.length });

	for (const pr of data.prs) {
		items.push({
			id: `github:pr:${pr._repo}:${pr.number}`,
			platform: "github",
			type: "pull_request",
			timestamp: pr.merged_at ?? pr.updated_at,
			title: pr.title,
			url: pr.url,
			payload: {
				type: "pull_request",
				repo: pr._repo,
				number: pr.number,
				title: pr.title,
				state: pr.state,
				action: pr.state,
				head_ref: pr.head_ref,
				base_ref: pr.base_ref,
				additions: pr.additions,
				deletions: pr.deletions,
				changed_files: pr.changed_files,
				commit_shas: pr.commit_shas,
				merge_commit_sha: pr.merge_commit_sha,
				commits: [],
			},
		});
	}

	log.debug("Normalized GitHub PRs", { count: data.prs.length });
	log.info("GitHub normalization complete", { total_items: items.length });
	return items;
};
