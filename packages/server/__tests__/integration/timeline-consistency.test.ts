import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CommitGroup, TimelineItem } from "@media/schema";
import { normalizeBluesky } from "@media/server/platforms";
import { rawStoreId } from "@media/server/storage";
import { type TimelineEntry, combineTimelines, groupByDate, groupCommits, normalizeGitHub } from "@media/server/timeline";
import { first, unwrap } from "@media/server/utils";
import { ACCOUNTS, BLUESKY_FIXTURES, GITHUB_FIXTURES, GITHUB_TIMELINE_FIXTURES, PROFILES, USERS, makeBlueskyFeedItem, makeBlueskyPost, makeBlueskyRaw, makeGitHubExtendedCommit, makeGitHubTimelineData } from "./fixtures";
import { type TestContext, createTestContext, seedAccount, seedProfile, seedUser } from "./setup";

const isCommitGroup = (entry: TimelineEntry): entry is CommitGroup => entry.type === "commit_group";

const daysAgo = (days: number): string => {
	const date = new Date();
	date.setDate(date.getDate() - days);
	date.setHours(12, 0, 0, 0);
	return date.toISOString();
};

const hoursAgo = (hours: number): string => {
	const date = new Date();
	date.setHours(date.getHours() - hours);
	return date.toISOString();
};

describe("timeline consistency", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("commit grouping", () => {
		it("groups commits from same repo on same day", async () => {
			const timestamp = daysAgo(0);
			const data = makeGitHubTimelineData([
				makeGitHubExtendedCommit({ sha: "aaa", date: timestamp, repo: "user/repo", message: "commit A" }),
				makeGitHubExtendedCommit({ sha: "bbb", date: timestamp, repo: "user/repo", message: "commit B" }),
				makeGitHubExtendedCommit({ sha: "ccc", date: timestamp, repo: "user/repo", message: "commit C" }),
			]);

			const items = normalizeGitHub(data);
			expect(items).toHaveLength(3);

			const grouped = groupCommits(items);
			expect(grouped).toHaveLength(1);

			const group = unwrap(first(grouped));
			expect(isCommitGroup(group)).toBe(true);
			if (isCommitGroup(group)) {
				expect(group.repo).toBe("user/repo");
				expect(group.commits).toHaveLength(3);
			}
		});

		it("keeps commits from different repos separate", async () => {
			const timestamp = daysAgo(0);
			const data = makeGitHubTimelineData([
				makeGitHubExtendedCommit({ sha: "aaa", date: timestamp, repo: "user/repo-a", message: "commit in repo-a" }),
				makeGitHubExtendedCommit({ sha: "bbb", date: timestamp, repo: "user/repo-b", message: "commit in repo-b" }),
			]);

			const items = normalizeGitHub(data);
			expect(items).toHaveLength(2);

			const grouped = groupCommits(items);
			expect(grouped).toHaveLength(2);

			const repos = grouped
				.filter(isCommitGroup)
				.map(g => g.repo)
				.sort();
			expect(repos).toEqual(["user/repo-a", "user/repo-b"]);
		});

		it("keeps commits from same repo on different days separate", async () => {
			const data = makeGitHubTimelineData([
				makeGitHubExtendedCommit({ sha: "today", date: daysAgo(0), repo: "user/repo", message: "today commit" }),
				makeGitHubExtendedCommit({ sha: "yesterday", date: daysAgo(1), repo: "user/repo", message: "yesterday commit" }),
			]);

			const items = normalizeGitHub(data);
			expect(items).toHaveLength(2);

			const grouped = groupCommits(items);
			expect(grouped).toHaveLength(2);

			const groups = grouped.filter(isCommitGroup);
			expect(groups).toHaveLength(2);
			expect(groups.every(g => g.repo === "user/repo")).toBe(true);
		});

		it("preserves non-commit items after grouping", async () => {
			const githubData = GITHUB_TIMELINE_FIXTURES.singleCommit();
			const blueskyRaw = BLUESKY_FIXTURES.singlePost();

			const commitItems = normalizeGitHub(githubData);
			const postItems = normalizeBluesky(blueskyRaw);
			const allItems = [...commitItems, ...postItems];

			const grouped = groupCommits(allItems);

			const commitGroups = grouped.filter(isCommitGroup);
			const posts = grouped.filter(e => e.type === "post");

			expect(commitGroups).toHaveLength(1);
			expect(posts).toHaveLength(1);
		});

		it("handles empty input", () => {
			const grouped = groupCommits([]);
			expect(grouped).toHaveLength(0);
		});

		it("handles only non-commit items", () => {
			const blueskyRaw = BLUESKY_FIXTURES.multiplePosts(3);
			const items = normalizeBluesky(blueskyRaw);

			const grouped = groupCommits(items);
			expect(grouped).toHaveLength(3);
			expect(grouped.every(e => e.type === "post")).toBe(true);
		});
	});

	describe("sorting", () => {
		it("sorts entries by date descending", () => {
			const items: TimelineItem[] = [
				{
					id: "old",
					platform: "github",
					type: "commit",
					timestamp: daysAgo(2),
					title: "old commit",
					url: "https://github.com/test/repo/commit/old",
					payload: { type: "commit", sha: "old", message: "old", repo: "test/repo", branch: "main" },
				},
				{
					id: "new",
					platform: "github",
					type: "commit",
					timestamp: daysAgo(0),
					title: "new commit",
					url: "https://github.com/test/repo/commit/new",
					payload: { type: "commit", sha: "new", message: "new", repo: "test/repo", branch: "main" },
				},
				{
					id: "mid",
					platform: "github",
					type: "commit",
					timestamp: daysAgo(1),
					title: "mid commit",
					url: "https://github.com/test/repo/commit/mid",
					payload: { type: "commit", sha: "mid", message: "mid", repo: "test/repo", branch: "main" },
				},
			];

			const sorted = combineTimelines(items);
			expect(sorted[0]?.id).toBe("new");
			expect(sorted[1]?.id).toBe("mid");
			expect(sorted[2]?.id).toBe("old");
		});

		it("groups items by date correctly", () => {
			const data = makeGitHubTimelineData([
				makeGitHubExtendedCommit({ date: daysAgo(0), repo: "user/repo", message: "today" }),
				makeGitHubExtendedCommit({ date: daysAgo(1), repo: "user/repo", message: "yesterday" }),
				makeGitHubExtendedCommit({ date: daysAgo(0), repo: "user/other", message: "also today" }),
			]);

			const items = normalizeGitHub(data);
			const grouped = groupCommits(items);
			const dateGroups = groupByDate(grouped);

			expect(dateGroups).toHaveLength(2);
			expect(dateGroups[0]?.items.length).toBe(2);
			expect(dateGroups[1]?.items.length).toBe(1);

			const today = new Date();
			today.setDate(today.getDate());
			const expectedDate = today.toISOString().split("T")[0];
			expect(dateGroups[0]?.date).toBe(expectedDate);
		});

		it("sorts date groups in descending order", () => {
			const entries: TimelineEntry[] = [
				{
					type: "commit_group",
					date: "2024-01-01",
					repo: "test/repo",
					branch: "main",
					commits: [],
					total_additions: 0,
					total_deletions: 0,
					total_files_changed: 0,
				},
				{
					type: "commit_group",
					date: "2024-01-03",
					repo: "test/repo",
					branch: "main",
					commits: [],
					total_additions: 0,
					total_deletions: 0,
					total_files_changed: 0,
				},
				{
					type: "commit_group",
					date: "2024-01-02",
					repo: "test/repo",
					branch: "main",
					commits: [],
					total_additions: 0,
					total_deletions: 0,
					total_files_changed: 0,
				},
			];

			const dateGroups = groupByDate(entries);

			expect(dateGroups[0]?.date).toBe("2024-01-03");
			expect(dateGroups[1]?.date).toBe("2024-01-02");
			expect(dateGroups[2]?.date).toBe("2024-01-01");
		});

		it("combines items from multiple platforms sorted by time", () => {
			const timestamp1 = hoursAgo(1);
			const timestamp2 = hoursAgo(2);
			const timestamp3 = hoursAgo(3);

			const githubData = makeGitHubTimelineData([makeGitHubExtendedCommit({ date: timestamp2, repo: "user/repo", message: "github" })]);

			const blueskyRaw = makeBlueskyRaw([
				makeBlueskyFeedItem({
					post: makeBlueskyPost({ record: { text: "newest", createdAt: timestamp1 } }),
				}),
				makeBlueskyFeedItem({
					post: makeBlueskyPost({ record: { text: "oldest", createdAt: timestamp3 } }),
				}),
			]);

			const items = [...normalizeGitHub(githubData), ...normalizeBluesky(blueskyRaw)];

			const sorted = combineTimelines(items);

			expect(sorted[0]?.platform).toBe("bluesky");
			expect(sorted[0]?.title).toContain("newest");
			expect(sorted[1]?.platform).toBe("github");
			expect(sorted[2]?.platform).toBe("bluesky");
			expect(sorted[2]?.title).toContain("oldest");
		});
	});

	describe("deduplication", () => {
		it("same content produces same content_hash", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			const store = ctx.corpus.createRawStore("github", ACCOUNTS.alice_github.id);

			const data = GITHUB_FIXTURES.singleCommit();

			const result1 = await store.put(data as Record<string, unknown>);
			expect(result1.ok).toBe(true);

			const result2 = await store.put(data as Record<string, unknown>);
			expect(result2.ok).toBe(true);

			if (result1.ok && result2.ok) {
				expect(result1.value.content_hash).toBe(result2.value.content_hash);
				expect(result1.value.version).not.toBe(result2.value.version);
			}
		});

		it("different content produces different content_hash", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			const store = ctx.corpus.createRawStore("github", ACCOUNTS.alice_github.id);

			const data1 = GITHUB_FIXTURES.singleCommit();
			const data2 = GITHUB_FIXTURES.multipleCommitsSameDay();

			const result1 = await store.put(data1 as Record<string, unknown>);
			const result2 = await store.put(data2 as Record<string, unknown>);

			expect(result1.ok).toBe(true);
			expect(result2.ok).toBe(true);

			if (result1.ok && result2.ok) {
				expect(result1.value.content_hash).not.toBe(result2.value.content_hash);
			}
		});

		it("stores with parent refs to raw snapshots", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			const rawStore = ctx.corpus.createRawStore("github", ACCOUNTS.alice_github.id);
			const timelineStore = ctx.corpus.createTimelineStore(USERS.alice.id);

			const rawData = GITHUB_FIXTURES.singleCommit();
			const rawResult = await rawStore.put(rawData as Record<string, unknown>);
			expect(rawResult.ok).toBe(true);

			if (!rawResult.ok) return;

			const timelineData = {
				user_id: USERS.alice.id,
				generated_at: new Date().toISOString(),
				groups: [],
			};

			const timelineResult = await timelineStore.put(timelineData, {
				parents: [
					{
						store_id: rawStoreId("github", ACCOUNTS.alice_github.id),
						version: rawResult.value.version,
						role: "source",
					},
				],
			});

			expect(timelineResult.ok).toBe(true);

			if (timelineResult.ok) {
				const parents = timelineResult.value.parents ?? [];
				expect(parents).toHaveLength(1);
				expect(parents[0]?.store_id).toBe(rawStoreId("github", ACCOUNTS.alice_github.id));
				expect(parents[0]?.version).toBe(rawResult.value.version);
			}
		});

		it("timeline version changes when raw data changes", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			const rawStore = ctx.corpus.createRawStore("github", ACCOUNTS.alice_github.id);
			const timelineStore = ctx.corpus.createTimelineStore(USERS.alice.id);

			const raw1 = GITHUB_FIXTURES.singleCommit();
			await rawStore.put(raw1 as Record<string, unknown>);

			const timeline1 = {
				user_id: USERS.alice.id,
				generated_at: new Date().toISOString(),
				groups: groupByDate(groupCommits(normalizeGitHub(GITHUB_TIMELINE_FIXTURES.singleCommit()))),
			};
			const t1Result = await timelineStore.put(timeline1);
			expect(t1Result.ok).toBe(true);

			const raw2 = GITHUB_FIXTURES.multipleCommitsSameDay();
			await rawStore.put(raw2 as Record<string, unknown>);

			const timeline2 = {
				user_id: USERS.alice.id,
				generated_at: new Date().toISOString(),
				groups: groupByDate(groupCommits(normalizeGitHub(GITHUB_TIMELINE_FIXTURES.multipleCommitsSameDay()))),
			};
			const t2Result = await timelineStore.put(timeline2);
			expect(t2Result.ok).toBe(true);

			if (t1Result.ok && t2Result.ok) {
				expect(t1Result.value.version).not.toBe(t2Result.value.version);
				expect(t1Result.value.content_hash).not.toBe(t2Result.value.content_hash);
			}
		});
	});

	describe("edge cases", () => {
		it("handles commits with very long messages", () => {
			const longMessage = "a".repeat(1000);
			const data = makeGitHubTimelineData([makeGitHubExtendedCommit({ message: longMessage })]);

			const items = normalizeGitHub(data);
			expect(items).toHaveLength(1);
			expect(items[0]?.title.length).toBeLessThanOrEqual(72);
		});

		it("handles commits with multi-line messages", () => {
			const multiLineMessage = "First line\n\nThis is a body\nWith multiple lines";
			const data = makeGitHubTimelineData([makeGitHubExtendedCommit({ message: multiLineMessage })]);

			const items = normalizeGitHub(data);
			expect(items[0]?.title).toBe("First line");
		});

		it("handles posts with special characters", () => {
			const specialText = 'Hello <world> & "friends" 🎉';
			const raw = makeBlueskyRaw([
				makeBlueskyFeedItem({
					post: makeBlueskyPost({
						record: { text: specialText, createdAt: new Date().toISOString() },
					}),
				}),
			]);

			const items = normalizeBluesky(raw);
			expect(items[0]?.title).toBe(specialText);
		});

		it("handles empty commits array", () => {
			const data = GITHUB_TIMELINE_FIXTURES.empty();
			const items = normalizeGitHub(data);
			expect(items).toHaveLength(0);
		});

		it("handles empty feed array", () => {
			const raw = BLUESKY_FIXTURES.empty();
			const items = normalizeBluesky(raw);
			expect(items).toHaveLength(0);
		});

		it("processes commits and ignores non-relevant events", () => {
			const data = GITHUB_TIMELINE_FIXTURES.withNonPushEvents();
			const items = normalizeGitHub(data);
			expect(items).toHaveLength(1);
			expect(items[0]?.type).toBe("commit");
		});
	});
});
