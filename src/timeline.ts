import type { CommitGroup, CommitPayload, DateGroup, PullRequestPayload, TimelineItem } from "./schema";
import { extractDateKey } from "./utils";

type TimelineEntry = TimelineItem | CommitGroup;
type CommitItem = TimelineItem & { payload: CommitPayload };
type PRItem = TimelineItem & { payload: PullRequestPayload };

// === HELPERS ===

const compareTimestampDesc = (a: TimelineEntry, b: TimelineEntry): number => new Date(getTimestamp(b)).getTime() - new Date(getTimestamp(a)).getTime();

const getTimestamp = (entry: TimelineEntry): string => (entry.type === "commit_group" ? (entry.commits[0]?.timestamp ?? entry.date) : entry.timestamp);

const getDateKey = (entry: TimelineEntry): string => (entry.type === "commit_group" ? entry.date : extractDateKey(entry.timestamp));

const isCommitItem = (item: TimelineItem): item is CommitItem => item.type === "commit" && item.payload.type === "commit";

const isPRItem = (item: TimelineItem): item is PRItem => item.type === "pull_request" && item.payload.type === "pull_request";

const makeGroupKey = (repo: string, branch: string, date: string): string => `${repo}:${branch}:${date}`;

const buildCommitGroup = (repo: string, branch: string, date: string, commits: CommitItem[]): CommitGroup => {
	const sorted = [...commits].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

	const totals = commits.reduce(
		(acc, c) => ({
			additions: acc.additions + (c.payload.additions ?? 0),
			deletions: acc.deletions + (c.payload.deletions ?? 0),
			files: acc.files + (c.payload.files_changed ?? 0),
		}),
		{ additions: 0, deletions: 0, files: 0 }
	);

	return {
		type: "commit_group",
		repo,
		branch,
		date,
		commits: sorted,
		total_additions: totals.additions,
		total_deletions: totals.deletions,
		total_files_changed: totals.files,
	};
};

// === DEDUPLICATION ===

type PRCommitInfo = {
	sha: string;
	message: string;
	url: string;
};

type DeduplicationResult = {
	orphanCommits: CommitItem[];
	enrichedPRs: PRItem[];
	otherItems: TimelineItem[];
};

/**
 * Associates commits with their parent PRs using SHA matching.
 * Commits found in a PR are removed from standalone display and attached to the PR.
 *
 * @param items - All timeline items (commits, PRs, posts, etc.)
 * @returns Separated items: orphan commits (not in any PR), enriched PRs (with commit details), other items
 */
const deduplicateCommitsFromPRs = (items: TimelineItem[]): DeduplicationResult => {
	const commits = items.filter(isCommitItem);
	const prs = items.filter(isPRItem);
	const otherItems = items.filter(i => !isCommitItem(i) && !isPRItem(i));

	console.log("[dedup] Input:", { commits: commits.length, prs: prs.length, other: otherItems.length });

	// Build a map of commit SHA -> commit item for quick lookup
	const commitBySha = new Map<string, CommitItem>();
	for (const commit of commits) {
		commitBySha.set(commit.payload.sha, commit);
	}

	// Build a set of all commit SHAs that belong to any PR
	const prCommitShas = new Set<string>();

	// Map PR id -> list of commit SHAs it owns
	const prToCommitShas = new Map<string, string[]>();

	for (const pr of prs) {
		// Get commit_shas from the raw PR data (stored in payload or retrieved from original)
		// We need to access the original PR's commit_shas which were stored during fetch
		const payload = pr.payload as PullRequestPayload & { commit_shas?: string[]; merge_commit_sha?: string };
		const shas = payload.commit_shas ?? [];

		prToCommitShas.set(pr.id, shas);
		for (const sha of shas) {
			prCommitShas.add(sha);
		}
		// Also add the merge commit SHA to prevent it appearing as orphan
		if (payload.merge_commit_sha) {
			prCommitShas.add(payload.merge_commit_sha);
		}
	}

	console.log("[dedup] Total commit SHAs claimed by PRs:", prCommitShas.size);

	// Separate orphan commits (not in any PR) from PR-owned commits
	const orphanCommits: CommitItem[] = [];
	for (const commit of commits) {
		if (!prCommitShas.has(commit.payload.sha)) {
			orphanCommits.push(commit);
		}
	}

	console.log("[dedup] Orphan commits (not in any PR):", orphanCommits.length);

	// Enrich PRs with their commit details
	const enrichedPRs = prs.map(pr => {
		const shas = prToCommitShas.get(pr.id) ?? [];
		const prCommits: PRCommitInfo[] = [];

		for (const sha of shas) {
			const commitItem = commitBySha.get(sha);
			if (commitItem) {
				prCommits.push({
					sha: commitItem.payload.sha,
					message: commitItem.payload.message,
					url: commitItem.url,
				});
			}
		}

		// Sort commits by... well, we don't have timestamps in the SHA list
		// They should already be in order from the API

		return {
			...pr,
			payload: {
				...pr.payload,
				commits: prCommits,
			},
		} as PRItem;
	});

	console.log("[dedup] Enriched PRs:", enrichedPRs.length);
	console.log("[dedup] PRs with commits:", enrichedPRs.filter(pr => (pr.payload.commits?.length ?? 0) > 0).length);

	return { orphanCommits, enrichedPRs, otherItems };
};

// === PUBLIC API ===

export const combineTimelines = (items: TimelineItem[]): TimelineItem[] => [...items].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

/**
 * Groups commits by repo/date and deduplicates commits that belong to PRs.
 *
 * Flow:
 * 1. Separate commits, PRs, and other items
 * 2. Match commits to PRs by SHA
 * 3. Orphan commits (not in any PR) get grouped by repo/date
 * 4. PRs get enriched with their commit details
 */
export const groupCommits = (items: TimelineItem[]): TimelineEntry[] => {
	console.log("[groupCommits] Input items count:", items.length);
	console.log(
		"[groupCommits] Input item types:",
		items.map(i => i.type)
	);

	// Step 1: Deduplicate commits that belong to PRs
	const { orphanCommits, enrichedPRs, otherItems } = deduplicateCommitsFromPRs(items);

	console.log("[groupCommits] After dedup - orphan commits:", orphanCommits.length);
	console.log("[groupCommits] After dedup - enriched PRs:", enrichedPRs.length);
	console.log("[groupCommits] After dedup - other items:", otherItems.length);

	// Step 2: Group only orphan commits by repo/branch/date
	const groupedByRepoBranchDate = orphanCommits.reduce<Map<string, CommitItem[]>>((acc, commit) => {
		const date = extractDateKey(commit.timestamp);
		const key = makeGroupKey(commit.payload.repo, commit.payload.branch, date);
		const existing = acc.get(key) ?? [];
		acc.set(key, [...existing, commit]);
		return acc;
	}, new Map());

	console.log("[groupCommits] Unique repo:branch:date groups:", groupedByRepoBranchDate.size);

	const commitGroups = Array.from(groupedByRepoBranchDate.entries()).map(([key, groupCommits]) => {
		const parts = key.split(":");
		const repo = parts[0] as string;
		const branch = parts[1] as string;
		const date = parts[2] as string;
		return buildCommitGroup(repo, branch, date, groupCommits);
	});

	console.log("[groupCommits] Commit groups created:", commitGroups.length);

	// Step 3: Combine all entries
	const result = [...commitGroups, ...enrichedPRs, ...otherItems];
	console.log("[groupCommits] Final output count:", result.length);
	console.log(
		"[groupCommits] Output types:",
		result.map(e => e.type)
	);

	return result;
};

export const groupByDate = (entries: TimelineEntry[]): DateGroup[] => {
	console.log("[groupByDate] Input entries count:", entries.length);
	console.log(
		"[groupByDate] Input entry types:",
		entries.map(e => e.type)
	);

	const sorted = [...entries].sort(compareTimestampDesc);

	const grouped = sorted.reduce<Map<string, TimelineEntry[]>>((acc, entry) => {
		const date = getDateKey(entry);
		const existing = acc.get(date) ?? [];
		acc.set(date, [...existing, entry]);
		return acc;
	}, new Map());

	console.log("[groupByDate] Unique dates found:", grouped.size);

	const result = Array.from(grouped.entries())
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([date, items]) => ({ date, items }));

	console.log("[groupByDate] Final groups count:", result.length);

	return result;
};

export type { TimelineEntry };
