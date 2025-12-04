import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { type CommitGroup, combineTimelines, groupByDate, groupCommits, normalizeBlueSky, normalizeGitHub, type TimelineEntry, type TimelineItem } from "@media-timeline/core";
import { ACCOUNTS, BLUESKY_FIXTURES, GITHUB_FIXTURES, makeBlueSkyFeedItem, makeBlueSkyPost, makeBlueSkyRaw, makeGitHubCommit, makeGitHubPushEvent, makeGitHubRaw, USERS } from "./fixtures";
import { createTestContext, seedAccount, seedUser, type TestContext } from "./setup";

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
			const raw = makeGitHubRaw([
				makeGitHubPushEvent({
					created_at: timestamp,
					repo: { id: 1, name: "user/repo", url: "https://api.github.com/repos/user/repo" },
					payload: {
						ref: "refs/heads/main",
						commits: [makeGitHubCommit({ sha: "aaa", message: "commit A" }), makeGitHubCommit({ sha: "bbb", message: "commit B" }), makeGitHubCommit({ sha: "ccc", message: "commit C" })],
					},
				}),
			]);

			const items = normalizeGitHub(raw);
			expect(items).toHaveLength(3);

			const grouped = groupCommits(items);
			expect(grouped).toHaveLength(1);

			const group = grouped[0];
			expect(isCommitGroup(group)).toBe(true);
			if (isCommitGroup(group)) {
				expect(group.repo).toBe("user/repo");
				expect(group.commits).toHaveLength(3);
			}
		});

		it("keeps commits from different repos separate", async () => {
			const timestamp = daysAgo(0);
			const raw = makeGitHubRaw([
				makeGitHubPushEvent({
					created_at: timestamp,
					repo: { id: 1, name: "user/repo-a", url: "https://api.github.com/repos/user/repo-a" },
					payload: {
						ref: "refs/heads/main",
						commits: [makeGitHubCommit({ sha: "aaa", message: "commit in repo-a" })],
					},
				}),
				makeGitHubPushEvent({
					created_at: timestamp,
					repo: { id: 2, name: "user/repo-b", url: "https://api.github.com/repos/user/repo-b" },
					payload: {
						ref: "refs/heads/main",
						commits: [makeGitHubCommit({ sha: "bbb", message: "commit in repo-b" })],
					},
				}),
			]);

			const items = normalizeGitHub(raw);
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
			const raw = makeGitHubRaw([
				makeGitHubPushEvent({
					created_at: daysAgo(0),
					repo: { id: 1, name: "user/repo", url: "https://api.github.com/repos/user/repo" },
					payload: {
						ref: "refs/heads/main",
						commits: [makeGitHubCommit({ sha: "today", message: "today commit" })],
					},
				}),
				makeGitHubPushEvent({
					created_at: daysAgo(1),
					repo: { id: 1, name: "user/repo", url: "https://api.github.com/repos/user/repo" },
					payload: {
						ref: "refs/heads/main",
						commits: [makeGitHubCommit({ sha: "yesterday", message: "yesterday commit" })],
					},
				}),
			]);

			const items = normalizeGitHub(raw);
			expect(items).toHaveLength(2);

			const grouped = groupCommits(items);
			expect(grouped).toHaveLength(2);

			const groups = grouped.filter(isCommitGroup);
			expect(groups).toHaveLength(2);
			expect(groups.every(g => g.repo === "user/repo")).toBe(true);
		});

		it("preserves non-commit items after grouping", async () => {
			const githubRaw = GITHUB_FIXTURES.singleCommit();
			const blueskyRaw = BLUESKY_FIXTURES.singlePost();

			const commitItems = normalizeGitHub(githubRaw);
			const postItems = normalizeBlueSky(blueskyRaw);
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
			const items = normalizeBlueSky(blueskyRaw);

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
					payload: { type: "commit", sha: "old", message: "old", repo: "test/repo" },
				},
				{
					id: "new",
					platform: "github",
					type: "commit",
					timestamp: daysAgo(0),
					title: "new commit",
					payload: { type: "commit", sha: "new", message: "new", repo: "test/repo" },
				},
				{
					id: "mid",
					platform: "github",
					type: "commit",
					timestamp: daysAgo(1),
					title: "mid commit",
					payload: { type: "commit", sha: "mid", message: "mid", repo: "test/repo" },
				},
			];

			const sorted = combineTimelines(items);
			expect(sorted[0].id).toBe("new");
			expect(sorted[1].id).toBe("mid");
			expect(sorted[2].id).toBe("old");
		});

		it("groups items by date correctly", () => {
			const raw = makeGitHubRaw([
				makeGitHubPushEvent({
					created_at: daysAgo(0),
					repo: { id: 1, name: "user/repo", url: "" },
					payload: { ref: "refs/heads/main", commits: [makeGitHubCommit({ message: "today" })] },
				}),
				makeGitHubPushEvent({
					created_at: daysAgo(1),
					repo: { id: 1, name: "user/repo", url: "" },
					payload: { ref: "refs/heads/main", commits: [makeGitHubCommit({ message: "yesterday" })] },
				}),
				makeGitHubPushEvent({
					created_at: daysAgo(0),
					repo: { id: 2, name: "user/other", url: "" },
					payload: { ref: "refs/heads/main", commits: [makeGitHubCommit({ message: "also today" })] },
				}),
			]);

			const items = normalizeGitHub(raw);
			const grouped = groupCommits(items);
			const dateGroups = groupByDate(grouped);

			expect(dateGroups).toHaveLength(2);
			expect(dateGroups[0].entries.length).toBe(2);
			expect(dateGroups[1].entries.length).toBe(1);

			const today = new Date();
			today.setDate(today.getDate());
			const expectedDate = today.toISOString().split("T")[0];
			expect(dateGroups[0].date).toBe(expectedDate);
		});

		it("sorts date groups in descending order", () => {
			const entries: TimelineEntry[] = [
				{
					id: "github:commit_group:repo:2024-01-01",
					platform: "github",
					type: "commit_group",
					timestamp: "2024-01-01T12:00:00Z",
					repo: "test/repo",
					commits: [],
					total_additions: 0,
					total_deletions: 0,
				},
				{
					id: "github:commit_group:repo:2024-01-03",
					platform: "github",
					type: "commit_group",
					timestamp: "2024-01-03T12:00:00Z",
					repo: "test/repo",
					commits: [],
					total_additions: 0,
					total_deletions: 0,
				},
				{
					id: "github:commit_group:repo:2024-01-02",
					platform: "github",
					type: "commit_group",
					timestamp: "2024-01-02T12:00:00Z",
					repo: "test/repo",
					commits: [],
					total_additions: 0,
					total_deletions: 0,
				},
			];

			const dateGroups = groupByDate(entries);

			expect(dateGroups[0].date).toBe("2024-01-03");
			expect(dateGroups[1].date).toBe("2024-01-02");
			expect(dateGroups[2].date).toBe("2024-01-01");
		});

		it("combines items from multiple platforms sorted by time", () => {
			const timestamp1 = hoursAgo(1);
			const timestamp2 = hoursAgo(2);
			const timestamp3 = hoursAgo(3);

			const githubRaw = makeGitHubRaw([
				makeGitHubPushEvent({
					created_at: timestamp2,
					repo: { id: 1, name: "user/repo", url: "" },
					payload: { ref: "refs/heads/main", commits: [makeGitHubCommit({ message: "github" })] },
				}),
			]);

			const blueskyRaw = makeBlueSkyRaw([
				makeBlueSkyFeedItem({
					post: makeBlueSkyPost({ record: { text: "newest", createdAt: timestamp1 } }),
				}),
				makeBlueSkyFeedItem({
					post: makeBlueSkyPost({ record: { text: "oldest", createdAt: timestamp3 } }),
				}),
			]);

			const items = [...normalizeGitHub(githubRaw), ...normalizeBlueSky(blueskyRaw)];

			const sorted = combineTimelines(items);

			expect(sorted[0].platform).toBe("bluesky");
			expect(sorted[0].title).toContain("newest");
			expect(sorted[1].platform).toBe("github");
			expect(sorted[2].platform).toBe("bluesky");
			expect(sorted[2].title).toContain("oldest");
		});
	});

	describe("deduplication", () => {
		it("same content produces same content_hash", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

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
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

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
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

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
						store_id: `raw/github/${ACCOUNTS.alice_github.id}`,
						version: rawResult.value.version,
						role: "source",
					},
				],
			});

			expect(timelineResult.ok).toBe(true);

			if (timelineResult.ok) {
				const parents = timelineResult.value.parents ?? [];
				expect(parents).toHaveLength(1);
				expect(parents[0].store_id).toBe(`raw/github/${ACCOUNTS.alice_github.id}`);
				expect(parents[0].version).toBe(rawResult.value.version);
			}
		});

		it("timeline version changes when raw data changes", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

			const rawStore = ctx.corpus.createRawStore("github", ACCOUNTS.alice_github.id);
			const timelineStore = ctx.corpus.createTimelineStore(USERS.alice.id);

			const raw1 = GITHUB_FIXTURES.singleCommit();
			await rawStore.put(raw1 as Record<string, unknown>);

			const timeline1 = {
				user_id: USERS.alice.id,
				generated_at: new Date().toISOString(),
				groups: groupByDate(groupCommits(normalizeGitHub(raw1))),
			};
			const t1Result = await timelineStore.put(timeline1);
			expect(t1Result.ok).toBe(true);

			const raw2 = GITHUB_FIXTURES.multipleCommitsSameDay();
			await rawStore.put(raw2 as Record<string, unknown>);

			const timeline2 = {
				user_id: USERS.alice.id,
				generated_at: new Date().toISOString(),
				groups: groupByDate(groupCommits(normalizeGitHub(raw2))),
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
			const raw = makeGitHubRaw([
				makeGitHubPushEvent({
					payload: {
						ref: "refs/heads/main",
						commits: [makeGitHubCommit({ message: longMessage })],
					},
				}),
			]);

			const items = normalizeGitHub(raw);
			expect(items).toHaveLength(1);
			expect(items[0].title.length).toBeLessThanOrEqual(72);
		});

		it("handles commits with multi-line messages", () => {
			const multiLineMessage = "First line\n\nThis is a body\nWith multiple lines";
			const raw = makeGitHubRaw([
				makeGitHubPushEvent({
					payload: {
						ref: "refs/heads/main",
						commits: [makeGitHubCommit({ message: multiLineMessage })],
					},
				}),
			]);

			const items = normalizeGitHub(raw);
			expect(items[0].title).toBe("First line");
		});

		it("handles posts with special characters", () => {
			const specialText = 'Hello <world> & "friends" 🎉';
			const raw = makeBlueSkyRaw([
				makeBlueSkyFeedItem({
					post: makeBlueSkyPost({
						record: { text: specialText, createdAt: new Date().toISOString() },
					}),
				}),
			]);

			const items = normalizeBlueSky(raw);
			expect(items[0].title).toBe(specialText);
		});

		it("handles empty events array", () => {
			const raw = GITHUB_FIXTURES.empty();
			const items = normalizeGitHub(raw);
			expect(items).toHaveLength(0);
		});

		it("handles empty feed array", () => {
			const raw = BLUESKY_FIXTURES.empty();
			const items = normalizeBlueSky(raw);
			expect(items).toHaveLength(0);
		});

		it("filters out non-PushEvent GitHub events", () => {
			const raw = GITHUB_FIXTURES.withNonPushEvents();
			const items = normalizeGitHub(raw);
			expect(items).toHaveLength(1);
			expect(items[0].type).toBe("commit");
		});
	});
});
