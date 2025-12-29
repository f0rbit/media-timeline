import type { CommitGroup, Platform, TimelineGroup, TimelineItem } from "@/utils/api-client";

export type DashboardStats = {
	totalEntries: number;
	activeDays: number;
	platforms: Platform[];
	lastActivity: string | null;
};

export type PlatformCount = {
	platform: Platform;
	count: number;
	percentage: number;
};

export type DailyActivity = {
	date: string;
	count: number;
};

export type ContentTypeCount = {
	type: string;
	count: number;
	percentage: number;
};

type TimelineEntry = TimelineItem | CommitGroup;

const isCommitGroup = (entry: TimelineEntry): entry is CommitGroup => entry.type === "commit_group";

const flattenGroups = (groups: TimelineGroup[]): TimelineEntry[] => groups.flatMap(g => g.items);

const getEntryTimestamp = (entry: TimelineEntry): string => (isCommitGroup(entry) ? entry.date : entry.timestamp);

const getEntryPlatform = (entry: TimelineEntry): Platform => (isCommitGroup(entry) ? "github" : entry.platform);

const getEntryType = (entry: TimelineEntry): string => (isCommitGroup(entry) ? "commits" : entry.type);

const toDateString = (timestamp: string): string => timestamp.slice(0, 10);

const formatDateISO = (date: Date): string => date.toISOString().slice(0, 10);

const generateDateRange = (days: number): string[] => {
	const today = new Date();
	return Array.from({ length: days }, (_, i) => {
		const d = new Date(today);
		d.setDate(d.getDate() - (days - 1 - i));
		return formatDateISO(d);
	});
};

const uniqueValues = <T>(arr: T[]): T[] => [...new Set(arr)];

const sortDescending = <T>(arr: T[], fn: (item: T) => string): T[] => [...arr].sort((a, b) => fn(b).localeCompare(fn(a)));

const toPercentage = (count: number, total: number): number => (total === 0 ? 0 : Math.round((count / total) * 100));

const groupBy = <T, K extends string>(items: T[], keyFn: (item: T) => K): Record<K, T[]> =>
	items.reduce(
		(acc, item) => {
			const key = keyFn(item);
			acc[key] = acc[key] ?? [];
			acc[key].push(item);
			return acc;
		},
		{} as Record<K, T[]>
	);

export function calculateDashboardStats(groups: TimelineGroup[]): DashboardStats {
	const entries = flattenGroups(groups);

	if (entries.length === 0) {
		return { totalEntries: 0, activeDays: 0, platforms: [], lastActivity: null };
	}

	const timestamps = entries.map(getEntryTimestamp);
	const uniqueDates = uniqueValues(timestamps.map(toDateString));
	const platforms = uniqueValues(entries.map(getEntryPlatform));
	const sorted = sortDescending(timestamps, t => t);

	return {
		totalEntries: entries.length,
		activeDays: uniqueDates.length,
		platforms,
		lastActivity: sorted[0] ?? null,
	};
}

export function calculatePlatformDistribution(groups: TimelineGroup[]): PlatformCount[] {
	const entries = flattenGroups(groups);
	const total = entries.length;

	if (total === 0) return [];

	const grouped = groupBy(entries, getEntryPlatform);

	return Object.entries(grouped)
		.map(([platform, items]) => ({
			platform: platform as Platform,
			count: items.length,
			percentage: toPercentage(items.length, total),
		}))
		.sort((a, b) => b.count - a.count);
}

export function calculateActivityByDay(groups: TimelineGroup[], days = 14): DailyActivity[] {
	const entries = flattenGroups(groups);
	const dateRange = generateDateRange(days);
	const countsByDate = groupBy(entries, e => toDateString(getEntryTimestamp(e)));

	return dateRange.map(date => ({
		date,
		count: countsByDate[date]?.length ?? 0,
	}));
}

export type WeeklyActivity = {
	weekStart: string;
	days: DailyActivity[];
};

export function calculateActivityByWeek(groups: TimelineGroup[], weeks = 53): WeeklyActivity[] {
	const entries = flattenGroups(groups);
	const countsByDate = groupBy(entries, e => toDateString(getEntryTimestamp(e)));

	const today = new Date();
	const todayDow = today.getDay(); // 0 = Sunday, 1 = Monday, etc.

	// Convert to Monday-based index (Mon=0, Tue=1, ..., Sun=6)
	const todayMondayIndex = todayDow === 0 ? 6 : todayDow - 1;

	// Find the Monday of the first week (go back 'weeks' full weeks, then to that Monday)
	const startDate = new Date(today);
	// Go back (weeks - 1) full weeks, then back to Monday of that week
	startDate.setDate(startDate.getDate() - (weeks - 1) * 7 - todayMondayIndex);

	const result: WeeklyActivity[] = [];

	for (let w = 0; w < weeks; w++) {
		const weekDays: DailyActivity[] = [];
		const weekStart = new Date(startDate);
		weekStart.setDate(weekStart.getDate() + w * 7);

		for (let d = 0; d < 7; d++) {
			const date = new Date(weekStart);
			date.setDate(date.getDate() + d);

			// Don't include future dates
			if (date > today) break;

			const dateStr = formatDateISO(date);
			weekDays.push({
				date: dateStr,
				count: countsByDate[dateStr]?.length ?? 0,
			});
		}

		if (weekDays.length > 0) {
			result.push({
				weekStart: weekDays[0].date,
				days: weekDays,
			});
		}
	}

	return result;
}

export function calculateContentTypes(groups: TimelineGroup[]): ContentTypeCount[] {
	const entries = flattenGroups(groups);
	const total = entries.length;

	if (total === 0) return [];

	const grouped = groupBy(entries, getEntryType);

	return Object.entries(grouped)
		.map(([type, items]) => ({
			type,
			count: items.length,
			percentage: toPercentage(items.length, total),
		}))
		.sort((a, b) => b.count - a.count);
}

export function getRecentItems(groups: TimelineGroup[], limit = 5): TimelineEntry[] {
	const entries = flattenGroups(groups);
	const sorted = sortDescending(entries, getEntryTimestamp);
	return sorted.slice(0, limit);
}

export function getItemsForDate(groups: TimelineGroup[], date: string): TimelineEntry[] {
	const entries = flattenGroups(groups);
	return entries.filter(e => toDateString(getEntryTimestamp(e)) === date);
}
