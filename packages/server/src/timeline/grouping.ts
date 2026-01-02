import type { CommitGroup, CommitPayload, DateGroup, PullRequestPayload, TimelineItem } from "@media/schema";
import { createLogger } from "../logger";
import { extract_date_key } from "../utils";

const log = createLogger("timeline");

type TimelineEntry = TimelineItem | CommitGroup;
type CommitItem = TimelineItem & { payload: CommitPayload };
type PRItem = TimelineItem & { payload: PullRequestPayload };

// === HELPERS ===

const compareTimestampDesc = (a: TimelineEntry, b: TimelineEntry): number => new Date(getTimestamp(b)).getTime() - new Date(getTimestamp(a)).getTime();

const getTimestamp = (entry: TimelineEntry): string => (entry.type === "commit_group" ? (entry.commits[0]?.timestamp ?? entry.date) : entry.timestamp);

const getDateKey = (entry: TimelineEntry): string => (entry.type === "commit_group" ? entry.date : extract_date_key(entry.timestamp));

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

const deduplicateCommitsFromPRs = (items: TimelineItem[]): DeduplicationResult => {
	const commits = items.filter(isCommitItem);
	const prs = items.filter(isPRItem);
	const otherItems = items.filter(i => !isCommitItem(i) && !isPRItem(i));

	const commitBySha = new Map<string, CommitItem>();
	for (const commit of commits) {
		commitBySha.set(commit.payload.sha, commit);
	}

	const prCommitShas = new Set<string>();
	const prToCommitShas = new Map<string, string[]>();

	for (const pr of prs) {
		const shas = pr.payload.commit_shas ?? [];
		prToCommitShas.set(pr.id, shas);
		for (const sha of shas) {
			prCommitShas.add(sha);
		}
		if (pr.payload.merge_commit_sha) {
			prCommitShas.add(pr.payload.merge_commit_sha);
		}
	}

	const orphanCommits: CommitItem[] = [];
	for (const commit of commits) {
		if (!prCommitShas.has(commit.payload.sha)) {
			orphanCommits.push(commit);
		}
	}

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

		return {
			...pr,
			payload: {
				...pr.payload,
				commits: prCommits,
			},
		} as PRItem;
	});

	return { orphanCommits, enrichedPRs, otherItems };
};

// === PUBLIC API ===

export const combineTimelines = (items: TimelineItem[]): TimelineItem[] => [...items].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

export const groupCommits = (items: TimelineItem[]): TimelineEntry[] => {
	log.debug("Grouping commits", { total_items: items.length });

	const { orphanCommits, enrichedPRs, otherItems } = deduplicateCommitsFromPRs(items);

	const groupedByRepoBranchDate = orphanCommits.reduce<Map<string, CommitItem[]>>((acc, commit) => {
		const date = extract_date_key(commit.timestamp);
		const key = makeGroupKey(commit.payload.repo, commit.payload.branch, date);
		const existing = acc.get(key) ?? [];
		acc.set(key, [...existing, commit]);
		return acc;
	}, new Map());

	const commitGroups = Array.from(groupedByRepoBranchDate.entries()).map(([key, groupCommits]) => {
		const parts = key.split(":");
		const repo = parts[0] as string;
		const branch = parts[1] as string;
		const date = parts[2] as string;
		return buildCommitGroup(repo, branch, date, groupCommits);
	});

	const result = [...commitGroups, ...enrichedPRs, ...otherItems];

	log.debug("Commit grouping complete", { commit_groups: commitGroups.length, total_entries: result.length });

	return result;
};

export const groupByDate = (entries: TimelineEntry[]): DateGroup[] => {
	log.debug("Grouping by date", { total_entries: entries.length });

	const sorted = [...entries].sort(compareTimestampDesc);

	const grouped = sorted.reduce<Map<string, TimelineEntry[]>>((acc, entry) => {
		const date = getDateKey(entry);
		const existing = acc.get(date) ?? [];
		acc.set(date, [...existing, entry]);
		return acc;
	}, new Map());

	const result = Array.from(grouped.entries())
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([date, items]) => ({ date, items }));

	log.debug("Date grouping complete", { date_groups: result.length });

	return result;
};

export type { TimelineEntry };
