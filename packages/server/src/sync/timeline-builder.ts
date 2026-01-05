import type { Backend } from "@f0rbit/corpus";
import { BlueskyRawSchema, type CommitGroup, DevpadRawSchema, type Platform, type TimelineItem, YouTubeRawSchema } from "@media/schema";
import { createLogger } from "../logger";
import { getPlatformsWithMultiStore, normalizeBluesky, normalizeDevpad, normalizeYouTube } from "../platforms";
import { createRawStore, createTimelineStore, rawStoreId } from "../storage";
import { groupByDate, groupCommits, loadGitHubDataForAccount, loadRedditDataForAccount, loadTwitterDataForAccount, normalizeGitHub, normalizeReddit, normalizeTwitter } from "../timeline";
import { type Result, pipe, to_nullable, try_catch } from "../utils";
import type { AccountWithUser, NormalizeError, PlatformGroups, RawSnapshot } from "./types";

const log = createLogger("sync:timeline");

type TimelineEntry = TimelineItem | CommitGroup;

const isMultiStore = (platform: string): boolean => {
	const multiStorePlatforms = getPlatformsWithMultiStore();
	return multiStorePlatforms.includes(platform as Platform);
};

export const groupSnapshotsByPlatform = (snapshots: RawSnapshot[]): PlatformGroups => ({
	github: snapshots.filter(s => s.platform === "github"),
	reddit: snapshots.filter(s => s.platform === "reddit"),
	twitter: snapshots.filter(s => s.platform === "twitter"),
	other: snapshots.filter(s => !isMultiStore(s.platform)),
});

export const loadPlatformItems = async <T>(backend: Backend, snapshots: RawSnapshot[], loader: (backend: Backend, accountId: string) => Promise<T>, normalizer: (data: T) => TimelineItem[]): Promise<TimelineItem[]> => {
	const items: TimelineItem[] = [];
	for (const snapshot of snapshots) {
		const data = await loader(backend, snapshot.account_id);
		items.push(...normalizer(data));
	}
	return items;
};

const normalizeSnapshot = (snapshot: RawSnapshot): Result<TimelineItem[], NormalizeError> =>
	try_catch(
		() => {
			const platform = snapshot.platform as Platform;
			switch (platform) {
				case "github":
				case "reddit":
				case "twitter":
					return [];
				case "bluesky": {
					const blueskyParsed = BlueskyRawSchema.parse(snapshot.data);
					return normalizeBluesky(blueskyParsed);
				}
				case "youtube": {
					const youtubeParsed = YouTubeRawSchema.parse(snapshot.data);
					return normalizeYouTube(youtubeParsed);
				}
				case "devpad": {
					const devpadParsed = DevpadRawSchema.parse(snapshot.data);
					return normalizeDevpad(devpadParsed);
				}
				default: {
					const _exhaustiveCheck: never = platform;
					log.warn("Unknown platform in normalizeSnapshot", { platform: snapshot.platform });
					return [];
				}
			}
		},
		(e): NormalizeError => ({ kind: "parse_error", platform: snapshot.platform, message: String(e) })
	);

export const normalizeOtherSnapshots = (snapshots: RawSnapshot[]): TimelineItem[] => {
	const results = snapshots.map(snapshot => normalizeSnapshot(snapshot));

	for (const r of results) {
		if (!r.ok) {
			log.error("Normalization failed", { platform: r.error.platform, message: r.error.message });
		}
	}

	return results.filter((r): r is { ok: true; value: TimelineItem[] } => r.ok).flatMap(r => r.value);
};

export const generateTimeline = (userId: string, items: TimelineItem[]) => {
	log.debug("Generating timeline", { user_id: userId, item_count: items.length });

	const entries: TimelineEntry[] = groupCommits(items);
	const dateGroups = groupByDate(entries);

	log.debug("Timeline generated", { user_id: userId, entries: entries.length, date_groups: dateGroups.length });

	return {
		user_id: userId,
		generated_at: new Date().toISOString(),
		groups: dateGroups,
	};
};

export const storeTimeline = async (backend: Backend, userId: string, timeline: ReturnType<typeof generateTimeline>, snapshots: RawSnapshot[]): Promise<void> => {
	const parents = snapshots.map(s => ({
		store_id: rawStoreId(s.platform, s.account_id),
		version: s.version,
		role: "source" as const,
	}));

	await pipe(createTimelineStore(backend, userId))
		.tap_err(() => log.error("Timeline store creation failed", { user_id: userId }))
		.tap(async ({ store }) => {
			await store.put(timeline, { parents });
		})
		.result();
};

const storeEmptyTimeline = async (backend: Backend, userId: string): Promise<void> => {
	const emptyTimeline = {
		user_id: userId,
		generated_at: new Date().toISOString(),
		groups: [],
	};
	await pipe(createTimelineStore(backend, userId))
		.tap(async ({ store }) => {
			await store.put(emptyTimeline, { parents: [] });
		})
		.result();
};

const getLatestSnapshot = async (backend: Backend, account: AccountWithUser): Promise<RawSnapshot | null> => {
	if (account.platform === "github") {
		const githubData = await loadGitHubDataForAccount(backend, account.id);
		if (githubData.commits.length === 0 && githubData.prs.length === 0) {
			return null;
		}
		return {
			account_id: account.id,
			platform: "github",
			version: new Date().toISOString(),
			data: { type: "github_multi_store" },
		};
	}

	if (account.platform === "reddit") {
		const redditData = await loadRedditDataForAccount(backend, account.id);
		if (redditData.posts.length === 0 && redditData.comments.length === 0) {
			return null;
		}
		return {
			account_id: account.id,
			platform: "reddit",
			version: new Date().toISOString(),
			data: { type: "reddit_multi_store" },
		};
	}

	if (account.platform === "twitter") {
		const twitterData = await loadTwitterDataForAccount(backend, account.id);
		if (twitterData.tweets.length === 0) {
			return null;
		}
		return {
			account_id: account.id,
			platform: "twitter",
			version: new Date().toISOString(),
			data: { type: "twitter_multi_store" },
		};
	}

	const storeResult = createRawStore(backend, account.platform, account.id);
	if (!storeResult.ok) {
		return null;
	}

	const snapshot = to_nullable(await storeResult.value.store.get_latest());
	if (!snapshot) {
		return null;
	}

	return {
		account_id: account.id,
		platform: account.platform,
		version: snapshot.meta.version,
		data: snapshot.data,
	};
};

export const gatherLatestSnapshots = async (backend: Backend, accounts: AccountWithUser[]): Promise<RawSnapshot[]> => {
	const results = await Promise.all(accounts.map(account => getLatestSnapshot(backend, account)));
	return results.filter((s): s is RawSnapshot => s !== null);
};

export const combineUserTimeline = async (backend: Backend, userId: string, snapshots: RawSnapshot[]): Promise<void> => {
	log.info("Building timeline", { user_id: userId, snapshot_count: snapshots.length });

	if (snapshots.length === 0) {
		await storeEmptyTimeline(backend, userId);
		return;
	}

	const byPlatform = groupSnapshotsByPlatform(snapshots);

	log.debug("Snapshots by platform", {
		github: byPlatform.github.length,
		reddit: byPlatform.reddit.length,
		twitter: byPlatform.twitter.length,
		other: byPlatform.other.length,
	});

	const [githubItems, redditItems, twitterItems] = await Promise.all([
		loadPlatformItems(backend, byPlatform.github, loadGitHubDataForAccount, normalizeGitHub),
		loadPlatformItems(backend, byPlatform.reddit, loadRedditDataForAccount, data => normalizeReddit(data, "")),
		loadPlatformItems(backend, byPlatform.twitter, loadTwitterDataForAccount, normalizeTwitter),
	]);

	const otherItems = normalizeOtherSnapshots(byPlatform.other);
	const allItems = [...githubItems, ...redditItems, ...twitterItems, ...otherItems];

	log.info("Timeline items loaded", {
		github: githubItems.length,
		reddit: redditItems.length,
		twitter: twitterItems.length,
		other: otherItems.length,
		total: allItems.length,
	});

	const timeline = generateTimeline(userId, allItems);
	await storeTimeline(backend, userId, timeline, snapshots);

	log.info("Timeline stored", {
		user_id: userId,
		date_groups: timeline.groups.length,
		generated_at: timeline.generated_at,
	});
};
