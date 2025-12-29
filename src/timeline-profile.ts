import type { Backend } from "@f0rbit/corpus";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./db";
import { createLogger } from "./logger";
import type { CommitGroup, DateGroup, Platform, TimelineItem } from "./schema";
import { accounts, profileFilters, profiles } from "./schema/database";
import type { Profile, ProfileFilter } from "./schema/database";
import { groupByDate, groupCommits } from "./timeline";
import { loadGitHubDataForAccount, normalizeGitHub } from "./timeline-github";
import { loadRedditDataForAccount, normalizeReddit } from "./timeline-reddit";
import { loadTwitterDataForAccount, normalizeTwitter } from "./timeline-twitter";
import type { Result } from "./utils";
import { err, ok } from "./utils";

const log = createLogger("timeline:profile");

type ProfileTimelineOptions = {
	db: Database;
	backend: Backend;
	profileId: string;
	limit?: number;
	before?: string;
};

type ProfileMeta = {
	profile_id: string;
	profile_slug: string;
	profile_name: string;
	generated_at: string;
};

type ProfileTimelineResult = {
	meta: ProfileMeta;
	data: {
		groups: DateGroup[];
	};
};

type ProfileSettings = {
	profile: Profile;
	accountIds: string[];
	filters: ProfileFilter[];
};

type ProfileTimelineError = { kind: "profile_not_found" } | { kind: "no_accounts" } | { kind: "timeline_generation_failed"; message: string };

type AccountInfo = {
	id: string;
	platform: Platform;
	platform_user_id: string | null;
};

type TimelineEntry = TimelineItem | CommitGroup;

const isCommitGroup = (entry: TimelineEntry): entry is CommitGroup => entry.type === "commit_group";

export async function loadProfileSettings(db: Database, profileId: string): Promise<ProfileSettings | null> {
	const profile = await db.select().from(profiles).where(eq(profiles.id, profileId)).get();

	if (!profile) return null;

	const profileAccounts = await db
		.select({ id: accounts.id })
		.from(accounts)
		.where(and(eq(accounts.profile_id, profileId), eq(accounts.is_active, true)));

	const accountIds = profileAccounts.map(a => a.id);

	const filterRows = await db.select().from(profileFilters).where(eq(profileFilters.profile_id, profileId));

	log.debug("Loaded profile settings", {
		profile_id: profileId,
		account_count: accountIds.length,
		filters: filterRows.length,
	});

	return {
		profile,
		accountIds,
		filters: filterRows,
	};
}

type FilterMatcher = (item: TimelineItem) => boolean;

const createFilterMatcher = (filter: ProfileFilter): FilterMatcher => {
	const { filter_key, filter_value } = filter;
	const valueLower = filter_value.toLowerCase();

	switch (filter_key) {
		case "repo":
			return (item: TimelineItem) => {
				if (item.platform !== "github") return false;
				const payload = item.payload as { repo?: string };
				return payload.repo?.toLowerCase() === valueLower;
			};

		case "subreddit":
			return (item: TimelineItem) => {
				if (item.platform !== "reddit") return false;
				const payload = item.payload as { subreddit?: string };
				return payload.subreddit?.toLowerCase() === valueLower;
			};

		case "twitter_account":
			return (item: TimelineItem) => {
				if (item.platform !== "twitter") return false;
				const payload = item.payload as { author_handle?: string };
				return payload.author_handle?.toLowerCase() === valueLower;
			};

		case "keyword":
			return (item: TimelineItem) => {
				const searchText = [item.title, "content" in item.payload ? (item.payload as { content?: string }).content : "", "message" in item.payload ? (item.payload as { message?: string }).message : ""]
					.filter(Boolean)
					.join(" ")
					.toLowerCase();
				return searchText.includes(valueLower);
			};

		default:
			return () => false;
	}
};

type FiltersByAccount = Map<string, { include: ProfileFilter[]; exclude: ProfileFilter[] }>;

const groupFiltersByAccount = (filters: ProfileFilter[]): FiltersByAccount => {
	const grouped: FiltersByAccount = new Map();

	for (const filter of filters) {
		const existing = grouped.get(filter.account_id) ?? { include: [], exclude: [] };
		if (filter.filter_type === "include") {
			existing.include.push(filter);
		} else {
			existing.exclude.push(filter);
		}
		grouped.set(filter.account_id, existing);
	}

	return grouped;
};

const applyFiltersToItem = (item: TimelineItem, accountFilters: { include: ProfileFilter[]; exclude: ProfileFilter[] }): boolean => {
	const { include, exclude } = accountFilters;

	if (exclude.length > 0) {
		const matchesAnyExclude = exclude.some(f => createFilterMatcher(f)(item));
		if (matchesAnyExclude) return false;
	}

	if (include.length > 0) {
		const matchesAnyInclude = include.some(f => createFilterMatcher(f)(item));
		if (!matchesAnyInclude) return false;
	}

	return true;
};

type AccountIdMap = Map<string, string>;

const buildAccountIdMap = (items: TimelineItem[], accountsByPlatform: Map<Platform, AccountInfo[]>): AccountIdMap => {
	const idMap: AccountIdMap = new Map();

	for (const item of items) {
		const platformAccounts = accountsByPlatform.get(item.platform);
		if (!platformAccounts || platformAccounts.length === 0) continue;

		const firstAccount = platformAccounts[0];
		if (!firstAccount) continue;

		if (platformAccounts.length === 1) {
			idMap.set(item.id, firstAccount.id);
			continue;
		}

		const matched = platformAccounts.find(acc => {
			if (item.platform === "twitter" && item.payload.type === "post") {
				const payload = item.payload as { author_handle?: string };
				return acc.platform_user_id === payload.author_handle;
			}
			return false;
		});

		idMap.set(item.id, matched?.id ?? firstAccount.id);
	}

	return idMap;
};

const loadAccountsForIds = async (db: Database, accountIds: string[]): Promise<AccountInfo[]> => {
	if (accountIds.length === 0) return [];

	return db
		.select({
			id: accounts.id,
			platform: accounts.platform,
			platform_user_id: accounts.platform_user_id,
		})
		.from(accounts)
		.where(and(inArray(accounts.id, accountIds), eq(accounts.is_active, true)));
};

const groupAccountsByPlatform = (accountList: AccountInfo[]): Map<Platform, AccountInfo[]> => {
	const grouped = new Map<Platform, AccountInfo[]>();

	for (const account of accountList) {
		const existing = grouped.get(account.platform) ?? [];
		existing.push(account);
		grouped.set(account.platform, existing);
	}

	return grouped;
};

type PlatformLoader = {
	load: (backend: Backend, accountId: string) => Promise<unknown>;
	normalize: (data: unknown) => TimelineItem[];
};

const platformLoaders: Record<string, PlatformLoader> = {
	github: {
		load: loadGitHubDataForAccount,
		normalize: data => normalizeGitHub(data as Awaited<ReturnType<typeof loadGitHubDataForAccount>>),
	},
	reddit: {
		load: loadRedditDataForAccount,
		normalize: data => normalizeReddit(data as Awaited<ReturnType<typeof loadRedditDataForAccount>>, ""),
	},
	twitter: {
		load: loadTwitterDataForAccount,
		normalize: data => normalizeTwitter(data as Awaited<ReturnType<typeof loadTwitterDataForAccount>>),
	},
};

const loadItemsForAccounts = async (backend: Backend, accountsByPlatform: Map<Platform, AccountInfo[]>): Promise<TimelineItem[]> => {
	const items: TimelineItem[] = [];

	for (const [platform, platformAccounts] of accountsByPlatform) {
		const loader = platformLoaders[platform];
		if (!loader) continue;

		for (const account of platformAccounts) {
			const data = await loader.load(backend, account.id);
			const normalized = loader.normalize(data);
			items.push(...normalized);
		}
	}

	return items;
};

const filterCommitGroup = (group: CommitGroup, filtersByAccount: FiltersByAccount, accountIdMap: AccountIdMap): CommitGroup | null => {
	if (filtersByAccount.size === 0) return group;

	const filteredCommits = group.commits.filter(commit => {
		const accountId = accountIdMap.get(commit.id);
		if (!accountId) return true;

		const accountFilters = filtersByAccount.get(accountId);
		if (!accountFilters) return true;

		return applyFiltersToItem(commit, accountFilters);
	});

	if (filteredCommits.length === 0) return null;

	const totals = filteredCommits.reduce(
		(acc, c) => {
			const payload = c.payload as { additions?: number; deletions?: number; files_changed?: number };
			return {
				additions: acc.additions + (payload.additions ?? 0),
				deletions: acc.deletions + (payload.deletions ?? 0),
				files: acc.files + (payload.files_changed ?? 0),
			};
		},
		{ additions: 0, deletions: 0, files: 0 }
	);

	return {
		...group,
		commits: filteredCommits,
		total_additions: totals.additions,
		total_deletions: totals.deletions,
		total_files_changed: totals.files,
	};
};

const filterTimelineEntries = (entries: TimelineEntry[], filters: ProfileFilter[], accountIdMap: AccountIdMap): TimelineEntry[] => {
	if (filters.length === 0) return entries;

	const filtersByAccount = groupFiltersByAccount(filters);

	return entries
		.map(entry => {
			if (isCommitGroup(entry)) {
				return filterCommitGroup(entry, filtersByAccount, accountIdMap);
			}

			const accountId = accountIdMap.get(entry.id);
			if (!accountId) return entry;

			const accountFilters = filtersByAccount.get(accountId);
			if (!accountFilters) return entry;

			return applyFiltersToItem(entry, accountFilters) ? entry : null;
		})
		.filter((entry): entry is TimelineEntry => entry !== null);
};

const applyPagination = (groups: DateGroup[], limit?: number, before?: string): DateGroup[] => {
	let filtered = groups;

	if (before) {
		filtered = filtered.filter(g => g.date < before);
	}

	if (limit && limit > 0) {
		let itemCount = 0;
		const limitedGroups: DateGroup[] = [];

		for (const group of filtered) {
			if (itemCount >= limit) break;

			const remainingItems = limit - itemCount;
			if (group.items.length <= remainingItems) {
				limitedGroups.push(group);
				itemCount += group.items.length;
			} else {
				limitedGroups.push({
					date: group.date,
					items: group.items.slice(0, remainingItems),
				});
				itemCount += remainingItems;
			}
		}

		return limitedGroups;
	}

	return filtered;
};

export async function generateProfileTimeline(options: ProfileTimelineOptions): Promise<Result<ProfileTimelineResult, ProfileTimelineError>> {
	const { db, backend, profileId, limit, before } = options;

	log.info("Generating profile timeline", { profile_id: profileId, limit, before });

	const settings = await loadProfileSettings(db, profileId);
	if (!settings) {
		log.warn("Profile not found", { profile_id: profileId });
		return err({ kind: "profile_not_found" });
	}

	const { profile, accountIds, filters } = settings;

	if (accountIds.length === 0) {
		log.info("No accounts for profile", { profile_id: profileId });
		return ok({
			meta: {
				profile_id: profile.id,
				profile_slug: profile.slug,
				profile_name: profile.name,
				generated_at: new Date().toISOString(),
			},
			data: { groups: [] },
		});
	}

	const accountList = await loadAccountsForIds(db, accountIds);
	const accountsByPlatform = groupAccountsByPlatform(accountList);

	log.debug("Loading items for accounts", {
		profile_id: profileId,
		account_count: accountList.length,
		platforms: Array.from(accountsByPlatform.keys()),
	});

	const items = await loadItemsForAccounts(backend, accountsByPlatform);
	const accountIdMap = buildAccountIdMap(items, accountsByPlatform);

	log.debug("Loaded timeline items", {
		profile_id: profileId,
		item_count: items.length,
		filter_count: filters.length,
	});

	const entries = groupCommits(items);
	const filteredEntries = filterTimelineEntries(entries, filters, accountIdMap);
	const dateGroups = groupByDate(filteredEntries);
	const paginatedGroups = applyPagination(dateGroups, limit, before);

	log.info("Profile timeline generated", {
		profile_id: profileId,
		date_groups: paginatedGroups.length,
		total_entries: filteredEntries.length,
	});

	return ok({
		meta: {
			profile_id: profile.id,
			profile_slug: profile.slug,
			profile_name: profile.name,
			generated_at: new Date().toISOString(),
		},
		data: { groups: paginatedGroups },
	});
}

export type { ProfileTimelineOptions, ProfileTimelineResult, ProfileSettings, ProfileTimelineError, ProfileMeta };
