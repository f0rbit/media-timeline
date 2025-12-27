import type { Backend } from "@f0rbit/corpus";
import type { GitHubRaw, GitHubRepoCommit, GitHubRepoPR, TimelineItem } from "./schema";
import { createGitHubCommitsStore, createGitHubPRsStore, listGitHubCommitStores, listGitHubPRStores } from "./storage";

type CommitWithRepo = GitHubRepoCommit & { _repo: string };
type PRWithRepo = GitHubRepoPR & { _repo: string };

type GitHubTimelineData = {
	commits: CommitWithRepo[];
	prs: PRWithRepo[];
};

export async function loadGitHubDataForAccount(backend: Backend, accountId: string): Promise<GitHubTimelineData> {
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

	console.log(`[loadGitHubDataForAccount] Loaded: ${commits.length} commits, ${prs.length} PRs`);
	return { commits, prs };
}

const truncateMessage = (message: string): string => {
	const firstLine = message.split("\n")[0] ?? "";
	return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
};

export function normalizeGitHub(data: GitHubTimelineData): TimelineItem[] {
	const items: TimelineItem[] = [];

	// Include ALL commits - deduplication happens in timeline.ts deduplicateCommitsFromPRs()
	// This ensures commits are available for PR enrichment
	for (const commit of data.commits) {
		items.push({
			id: `github:commit:${commit._repo}:${commit.sha.slice(0, 7)}`,
			platform: "github",
			type: "commit",
			timestamp: commit.author_date,
			title: truncateMessage(commit.message),
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

	console.log(`[normalizeGitHub] Total commits: ${data.commits.length}`);

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

	console.log(`[normalizeGitHub] Total PRs: ${data.prs.length}`);
	console.log(`[normalizeGitHub] Total timeline items: ${items.length}`);
	return items;
}

// Legacy normalizer for the old GitHubRaw format (used in tests and old snapshots)
export function normalizeGitHubLegacy(raw: GitHubRaw): TimelineItem[] {
	const items: TimelineItem[] = [];

	for (const commit of raw.commits) {
		items.push({
			id: `github:commit:${commit.repo}:${commit.sha.slice(0, 7)}`,
			platform: "github",
			type: "commit",
			timestamp: commit.date,
			title: truncateMessage(commit.message),
			url: commit.url,
			payload: {
				type: "commit",
				sha: commit.sha,
				message: commit.message,
				repo: commit.repo,
				branch: commit.branch,
			},
		});
	}

	const prMap = new Map<string, (typeof raw.pull_requests)[number]>();
	for (const pr of raw.pull_requests) {
		const key = `${pr.repo}:${pr.number}`;
		const existing = prMap.get(key);
		if (!existing || new Date(pr.created_at) > new Date(existing.created_at)) {
			prMap.set(key, pr);
		}
	}

	for (const pr of prMap.values()) {
		items.push({
			id: `github:pr:${pr.repo}:${pr.number}`,
			platform: "github",
			type: "pull_request",
			timestamp: pr.merged_at ?? pr.created_at,
			title: pr.title,
			url: pr.url,
			payload: {
				type: "pull_request",
				repo: pr.repo,
				number: pr.number,
				title: pr.title,
				state: pr.state,
				action: pr.action,
				head_ref: pr.head_ref,
				base_ref: pr.base_ref,
				commit_shas: [],
				merge_commit_sha: null,
				commits: [],
			},
		});
	}

	return items;
}

export type { GitHubTimelineData, CommitWithRepo, PRWithRepo };
