import type { CommitGroup, CommitPayload, DateGroup, TimelineItem } from "@media-timeline/schema";
import { extractDateKey } from "./utils";

type TimelineEntry = TimelineItem | CommitGroup;

const isCommitItem = (item: TimelineItem): item is TimelineItem & { payload: CommitPayload } => item.type === "commit" && item.payload.type === "commit";

const makeGroupKey = (repo: string, date: string): string => `${repo}:${date}`;

type CommitItem = TimelineItem & { payload: CommitPayload };

const buildCommitGroup = (repo: string, date: string, commits: CommitItem[]): CommitGroup => {
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
		date,
		commits: sorted,
		total_additions: totals.additions,
		total_deletions: totals.deletions,
		total_files_changed: totals.files,
	};
};

export const groupCommits = (items: TimelineItem[]): TimelineEntry[] => {
	const commits = items.filter(isCommitItem);
	const nonCommits = items.filter(item => !isCommitItem(item));

	const groupedByRepoDate = commits.reduce<Map<string, CommitItem[]>>((acc, commit) => {
		const date = extractDateKey(commit.timestamp);
		const key = makeGroupKey(commit.payload.repo, date);
		const existing = acc.get(key) ?? [];
		acc.set(key, [...existing, commit]);
		return acc;
	}, new Map());

	const commitGroups = Array.from(groupedByRepoDate.entries()).map(([key, groupCommits]) => {
		const [repo, date] = key.split(":") as [string, string];
		return buildCommitGroup(repo, date, groupCommits);
	});

	return [...commitGroups, ...nonCommits];
};

const getTimestamp = (entry: TimelineEntry): string => (entry.type === "commit_group" ? (entry.commits[0]?.timestamp ?? entry.date) : entry.timestamp);

const compareTimestampDesc = (a: TimelineEntry, b: TimelineEntry): number => new Date(getTimestamp(b)).getTime() - new Date(getTimestamp(a)).getTime();

const getDateKey = (entry: TimelineEntry): string => (entry.type === "commit_group" ? entry.date : extractDateKey(entry.timestamp));

export const groupByDate = (entries: TimelineEntry[]): DateGroup[] => {
	const sorted = [...entries].sort(compareTimestampDesc);

	const grouped = sorted.reduce<Map<string, TimelineEntry[]>>((acc, entry) => {
		const date = getDateKey(entry);
		const existing = acc.get(date) ?? [];
		acc.set(date, [...existing, entry]);
		return acc;
	}, new Map());

	return Array.from(grouped.entries())
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([date, items]) => ({ date, items }));
};
