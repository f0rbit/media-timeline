import { format, parseISO } from "date-fns";
import type { CommitGroup, CommitPayload, DateGroup, TimelineEntry, TimelineItem } from "./types";

const isCommitItem = (item: TimelineItem): item is TimelineItem & { payload: CommitPayload } => item.type === "commit" && item.payload.type === "commit";

const extractDateKey = (timestamp: string): string => format(parseISO(timestamp), "yyyy-MM-dd");

const makeGroupKey = (repo: string, date: string): string => `${repo}:${date}`;

const makeGroupId = (repo: string, date: string): string => `github:commit_group:${repo}:${date}`;

type CommitItem = TimelineItem & { payload: CommitPayload };

const buildCommitGroup = (repo: string, date: string, commits: CommitItem[]): CommitGroup => {
	const sorted = [...commits].sort((a, b) => parseISO(b.timestamp).getTime() - parseISO(a.timestamp).getTime());
	const latestTimestamp = sorted[0]?.timestamp ?? new Date().toISOString();

	const totals = commits.reduce(
		(acc, c) => ({
			additions: acc.additions + (c.payload.additions ?? 0),
			deletions: acc.deletions + (c.payload.deletions ?? 0),
		}),
		{ additions: 0, deletions: 0 }
	);

	return {
		id: makeGroupId(repo, date),
		platform: "github",
		type: "commit_group",
		timestamp: latestTimestamp,
		repo,
		commits: sorted.map(c => ({
			sha: c.payload.sha,
			message: c.payload.message,
			timestamp: c.timestamp,
		})),
		total_additions: totals.additions,
		total_deletions: totals.deletions,
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

const compareTimestampDesc = (a: TimelineEntry, b: TimelineEntry): number => parseISO(b.timestamp).getTime() - parseISO(a.timestamp).getTime();

export const groupByDate = (entries: TimelineEntry[]): DateGroup[] => {
	const sorted = [...entries].sort(compareTimestampDesc);

	const grouped = sorted.reduce<Map<string, TimelineEntry[]>>((acc, entry) => {
		const date = extractDateKey(entry.timestamp);
		const existing = acc.get(date) ?? [];
		acc.set(date, [...existing, entry]);
		return acc;
	}, new Map());

	return Array.from(grouped.entries())
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([date, entries]) => ({ date, entries }));
};
