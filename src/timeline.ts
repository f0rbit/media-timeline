import type { CommitGroup, CommitPayload, DateGroup, TimelineItem } from "./schema";
import { extractDateKey } from "./utils";

type TimelineEntry = TimelineItem | CommitGroup;
type CommitItem = TimelineItem & { payload: CommitPayload };

const compareTimestampDesc = (a: TimelineEntry, b: TimelineEntry): number => new Date(getTimestamp(b)).getTime() - new Date(getTimestamp(a)).getTime();

const getTimestamp = (entry: TimelineEntry): string => (entry.type === "commit_group" ? (entry.commits[0]?.timestamp ?? entry.date) : entry.timestamp);

const getDateKey = (entry: TimelineEntry): string => (entry.type === "commit_group" ? entry.date : extractDateKey(entry.timestamp));

const isCommitItem = (item: TimelineItem): item is CommitItem => item.type === "commit" && item.payload.type === "commit";

const makeGroupKey = (repo: string, date: string): string => `${repo}:${date}`;

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

export const combineTimelines = (items: TimelineItem[]): TimelineItem[] => [...items].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

export const groupCommits = (items: TimelineItem[]): TimelineEntry[] => {
	console.log("[groupCommits] Input items count:", items.length);
	console.log(
		"[groupCommits] Input item types:",
		items.map(i => i.type)
	);

	const commits = items.filter(isCommitItem);
	const nonCommits = items.filter(item => !isCommitItem(item));
	console.log("[groupCommits] Commits found:", commits.length);
	console.log("[groupCommits] Non-commits found:", nonCommits.length);

	const groupedByRepoDate = commits.reduce<Map<string, CommitItem[]>>((acc, commit) => {
		const date = extractDateKey(commit.timestamp);
		const key = makeGroupKey(commit.payload.repo, date);
		const existing = acc.get(key) ?? [];
		acc.set(key, [...existing, commit]);
		return acc;
	}, new Map());
	console.log("[groupCommits] Unique repo:date groups:", groupedByRepoDate.size);
	console.log("[groupCommits] Group keys:", Array.from(groupedByRepoDate.keys()));

	const commitGroups = Array.from(groupedByRepoDate.entries()).map(([key, groupCommits]) => {
		const [repo, date] = key.split(":") as [string, string];
		console.log(`[groupCommits] Building group for ${key}: ${groupCommits.length} commits`);
		return buildCommitGroup(repo, date, groupCommits);
	});
	console.log("[groupCommits] Commit groups created:", commitGroups.length);

	const result = [...commitGroups, ...nonCommits];
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
	console.log("[groupByDate] Sorted entries count:", sorted.length);

	const grouped = sorted.reduce<Map<string, TimelineEntry[]>>((acc, entry) => {
		const date = getDateKey(entry);
		const existing = acc.get(date) ?? [];
		acc.set(date, [...existing, entry]);
		return acc;
	}, new Map());
	console.log("[groupByDate] Unique dates found:", grouped.size);
	console.log("[groupByDate] Dates:", Array.from(grouped.keys()));
	console.log(
		"[groupByDate] Items per date:",
		Array.from(grouped.entries()).map(([d, items]) => ({ date: d, count: items.length }))
	);

	const result = Array.from(grouped.entries())
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([date, items]) => ({ date, items }));

	console.log("[groupByDate] Final groups count:", result.length);
	console.log(
		"[groupByDate] Final groups:",
		result.map(g => ({ date: g.date, itemCount: g.items.length }))
	);
	if (result.length > 0) {
		console.log("[groupByDate] First group preview:", JSON.stringify(result[0]).slice(0, 500));
	}
	return result;
};

export type { TimelineEntry };
