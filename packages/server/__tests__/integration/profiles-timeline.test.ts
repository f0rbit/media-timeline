import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { GitHubRepoCommitsStore } from "@media/schema";
import type { GitHubMetaStore } from "@media/schema";
import type { RedditPostsStore } from "@media/schema";
import type { TwitterTweetsStore } from "@media/schema";
import { createGitHubCommitsStore, createGitHubMetaStore, createRedditPostsStore, createTwitterTweetsStore } from "@media/server/storage";
import { unwrap } from "@media/server/utils";
import { ACCOUNTS, API_KEYS, PROFILES, USERS } from "./fixtures";
import { type ProfileFilterSeed, type TestContext, createTestApp, createTestContext, seedAccount, seedApiKey, seedProfile, seedProfileFilter, seedUser } from "./setup";

type TimelineItem = {
	id: string;
	platform: string;
	type: string;
	timestamp: string;
	title: string;
	url: string;
	payload: Record<string, unknown>;
};

type CommitGroup = {
	type: "commit_group";
	repo: string;
	branch: string;
	date: string;
	commits: TimelineItem[];
	total_additions: number;
	total_deletions: number;
	total_files_changed: number;
};

type TimelineEntry = TimelineItem | CommitGroup;

type ProfileTimelineResponse = {
	meta: {
		profile_id: string;
		profile_slug: string;
		profile_name: string;
		generated_at: string;
	};
	data: {
		groups: Array<{
			date: string;
			items: TimelineEntry[];
		}>;
	};
};

const isCommitGroup = (entry: TimelineEntry): entry is CommitGroup => entry.type === "commit_group";

const flattenItems = (groups: ProfileTimelineResponse["data"]["groups"]): TimelineItem[] => {
	const items: TimelineItem[] = [];
	for (const group of groups) {
		for (const entry of group.items) {
			if (isCommitGroup(entry)) {
				items.push(...entry.commits);
			} else {
				items.push(entry);
			}
		}
	}
	return items;
};

const countItems = (groups: ProfileTimelineResponse["data"]["groups"]): number => flattenItems(groups).length;

type ErrorResponse = { error: string; message: string };

const ensureGitHubMeta = async (ctx: TestContext, accountId: string, username: string, repos: Array<{ owner: string; name: string }>) => {
	const storeResult = createGitHubMetaStore(ctx.appContext.backend, accountId);
	const { store } = unwrap(storeResult);

	const existingResult = await store.get_latest();
	const existingRepos = existingResult.ok ? existingResult.value.data.repositories : [];

	const newRepos = repos.filter(r => !existingRepos.some((e: GitHubMetaStore["repositories"][0]) => e.owner === r.owner && e.name === r.name));

	const allRepos = [
		...existingRepos,
		...newRepos.map(r => ({
			owner: r.owner,
			name: r.name,
			full_name: `${r.owner}/${r.name}`,
			default_branch: "main",
			branches: ["main"],
			is_private: false,
			pushed_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		})),
	];

	await store.put({
		username,
		repositories: allRepos,
		total_repos_available: allRepos.length,
		repos_fetched: allRepos.length,
		fetched_at: new Date().toISOString(),
	});
};

const seedGitHubCommits = async (ctx: TestContext, accountId: string, owner: string, repo: string, commits: GitHubRepoCommitsStore["commits"]) => {
	await ensureGitHubMeta(ctx, accountId, "alice", [{ owner, name: repo }]);

	const storeResult = createGitHubCommitsStore(ctx.appContext.backend, accountId, owner, repo);
	const { store } = unwrap(storeResult);
	await store.put({
		owner,
		repo,
		branches: ["main"],
		commits,
		total_commits: commits.length,
		fetched_at: new Date().toISOString(),
	});
};

const seedRedditPosts = async (ctx: TestContext, accountId: string, username: string, posts: RedditPostsStore["posts"]) => {
	const storeResult = createRedditPostsStore(ctx.appContext.backend, accountId);
	const { store } = unwrap(storeResult);
	await store.put({
		username,
		posts,
		total_posts: posts.length,
		fetched_at: new Date().toISOString(),
	});
};

const seedTwitterTweets = async (ctx: TestContext, accountId: string, userId: string, username: string, tweets: TwitterTweetsStore["tweets"]) => {
	const storeResult = createTwitterTweetsStore(ctx.appContext.backend, accountId);
	const { store } = unwrap(storeResult);
	await store.put({
		user_id: userId,
		username,
		tweets,
		media: [],
		total_tweets: tweets.length,
		fetched_at: new Date().toISOString(),
	});
};

const makeGitHubCommit = (message: string, timestamp: string, sha?: string) => ({
	sha: sha ?? crypto.randomUUID().slice(0, 7),
	message,
	author_name: "Alice",
	author_email: "alice@example.com",
	author_date: timestamp,
	committer_name: "Alice",
	committer_email: "alice@example.com",
	committer_date: timestamp,
	url: `https://github.com/alice/project/commit/${sha ?? "abc1234"}`,
	branch: "main",
});

const makeRedditPost = (subreddit: string, title: string, timestamp: string) => ({
	id: crypto.randomUUID().slice(0, 7),
	name: `t3_${crypto.randomUUID().slice(0, 7)}`,
	title,
	selftext: `Post in ${subreddit}`,
	url: `https://reddit.com/r/${subreddit}/comments/abc123`,
	permalink: `/r/${subreddit}/comments/abc123`,
	subreddit,
	subreddit_prefixed: `r/${subreddit}`,
	author: "alice_redditor",
	created_utc: new Date(timestamp).getTime() / 1000,
	score: 42,
	upvote_ratio: 0.95,
	num_comments: 5,
	is_self: true,
	is_video: false,
	over_18: false,
	spoiler: false,
	stickied: false,
	locked: false,
	archived: false,
});

const makeTwitterTweet = (text: string, timestamp: string) => ({
	id: crypto.randomUUID().slice(0, 19).replace(/-/g, ""),
	text,
	created_at: timestamp,
	author_id: ACCOUNTS.alice_twitter.platform_user_id ?? "123456789",
	public_metrics: {
		retweet_count: 5,
		reply_count: 2,
		like_count: 42,
		quote_count: 1,
	},
	possibly_sensitive: false,
});

describe("Profile Timeline API", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("GET /media/api/v1/profiles/:slug/timeline", () => {
		describe("Basic timeline generation", () => {
			it("returns full timeline for profile with all accounts", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
				await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
				await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_reddit);
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "project", [makeGitHubCommit("feat: add feature", "2024-01-15T14:00:00Z")]);

				await seedRedditPosts(ctx, ACCOUNTS.alice_reddit.id, "alice_redditor", [makeRedditPost("programming", "My first post", "2024-01-15T10:00:00Z")]);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.slug}/timeline`, {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(200);
				const data = (await res.json()) as ProfileTimelineResponse;
				expect(data.meta.profile_slug).toBe(PROFILES.alice_main.slug);
				expect(data.meta.profile_name).toBe(PROFILES.alice_main.name);
				expect(data.data.groups).toHaveLength(1);
				expect(countItems(data.data.groups)).toBe(2);
			});

			it("returns correct response format with meta and data.groups", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
				await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "project", [makeGitHubCommit("initial commit", "2024-01-15T12:00:00Z")]);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.slug}/timeline`, {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(200);
				const data = (await res.json()) as ProfileTimelineResponse;

				expect(data).toHaveProperty("meta");
				expect(data).toHaveProperty("data");
				expect(data.data).toHaveProperty("groups");
				expect(data.meta).toHaveProperty("profile_id");
				expect(data.meta).toHaveProperty("profile_slug");
				expect(data.meta).toHaveProperty("profile_name");
				expect(data.meta).toHaveProperty("generated_at");
			});

			it("shows all accounts on a profile", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
				await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
				await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_reddit);
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "project", [makeGitHubCommit("commit", "2024-01-15T14:00:00Z")]);

				await seedRedditPosts(ctx, ACCOUNTS.alice_reddit.id, "alice_redditor", [makeRedditPost("programming", "post", "2024-01-15T10:00:00Z")]);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.slug}/timeline`, {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(200);
				const data = (await res.json()) as ProfileTimelineResponse;
				expect(data.data.groups).toHaveLength(1);
				expect(data.data.groups[0]?.items).toHaveLength(2);
			});
		});

		describe("Content filters - Include", () => {
			it("include filter for specific repo only shows that repo commits", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_work);
				await seedAccount(ctx, PROFILES.alice_work.id, ACCOUNTS.alice_github);
				await seedProfileFilter(ctx, PROFILES.alice_work.id, {
					account_id: ACCOUNTS.alice_github.id,
					filter_type: "include",
					filter_key: "repo",
					filter_value: "alice/work-project",
				});
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "work-project", [makeGitHubCommit("work commit", "2024-01-15T14:00:00Z"), makeGitHubCommit("another work commit", "2024-01-15T10:00:00Z")]);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "personal-project", [makeGitHubCommit("personal commit", "2024-01-15T12:00:00Z")]);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_work.slug}/timeline`, {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(200);
				const data = (await res.json()) as ProfileTimelineResponse;
				expect(data.data.groups).toHaveLength(1);

				const items = flattenItems(data.data.groups);
				expect(items.length).toBeGreaterThan(0);
				for (const item of items) {
					expect((item.payload as { repo: string }).repo).toBe("alice/work-project");
				}
			});

			it("include filter for subreddit only shows posts from that subreddit", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_work);
				await seedAccount(ctx, PROFILES.alice_work.id, ACCOUNTS.alice_reddit);
				await seedProfileFilter(ctx, PROFILES.alice_work.id, {
					account_id: ACCOUNTS.alice_reddit.id,
					filter_type: "include",
					filter_key: "subreddit",
					filter_value: "typescript",
				});
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				await seedRedditPosts(ctx, ACCOUNTS.alice_reddit.id, "alice_redditor", [
					makeRedditPost("typescript", "TS question", "2024-01-15T14:00:00Z"),
					makeRedditPost("javascript", "JS question", "2024-01-15T12:00:00Z"),
					makeRedditPost("typescript", "Another TS post", "2024-01-15T10:00:00Z"),
				]);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_work.slug}/timeline`, {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(200);
				const data = (await res.json()) as ProfileTimelineResponse;
				expect(data.data.groups).toHaveLength(1);
				const items = flattenItems(data.data.groups);
				expect(items).toHaveLength(2);
				for (const item of items) {
					expect((item.payload as { subreddit: string }).subreddit).toBe("typescript");
				}
			});
		});

		describe("Content filters - Exclude", () => {
			it("exclude filter for repo hides that repo commits", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
				await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
				await seedProfileFilter(ctx, PROFILES.alice_main.id, {
					account_id: ACCOUNTS.alice_github.id,
					filter_type: "exclude",
					filter_key: "repo",
					filter_value: "alice/private-project",
				});
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "public-project", [makeGitHubCommit("public commit", "2024-01-15T14:00:00Z")]);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "private-project", [makeGitHubCommit("private commit", "2024-01-15T12:00:00Z")]);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "another-public", [makeGitHubCommit("another public", "2024-01-15T10:00:00Z")]);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.slug}/timeline`, {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(200);
				const data = (await res.json()) as ProfileTimelineResponse;
				expect(data.data.groups).toHaveLength(1);

				const items = flattenItems(data.data.groups);
				expect(items.length).toBeGreaterThan(0);
				for (const item of items) {
					expect((item.payload as { repo: string }).repo).not.toBe("alice/private-project");
				}
			});

			it("exclude filter for keyword hides matching content", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
				await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);
				await seedProfileFilter(ctx, PROFILES.alice_main.id, {
					account_id: ACCOUNTS.alice_twitter.id,
					filter_type: "exclude",
					filter_key: "keyword",
					filter_value: "secret",
				});
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				await seedTwitterTweets(ctx, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.platform_user_id ?? "123", ACCOUNTS.alice_twitter.platform_username ?? "alice_tweeter", [
					makeTwitterTweet("Check out my new project!", "2024-01-15T14:00:00Z"),
					makeTwitterTweet("This is a secret project", "2024-01-15T12:00:00Z"),
					makeTwitterTweet("Another public tweet", "2024-01-15T10:00:00Z"),
				]);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.slug}/timeline`, {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(200);
				const data = (await res.json()) as ProfileTimelineResponse;
				expect(data.data.groups).toHaveLength(1);
				const items = flattenItems(data.data.groups);
				expect(items).toHaveLength(2);
				for (const item of items) {
					expect((item.payload as { content: string }).content.toLowerCase()).not.toContain("secret");
				}
			});
		});

		describe("Combined filters", () => {
			it("include filter works with account on profile", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_work);
				await seedAccount(ctx, PROFILES.alice_work.id, ACCOUNTS.alice_github);
				await seedProfileFilter(ctx, PROFILES.alice_work.id, {
					account_id: ACCOUNTS.alice_github.id,
					filter_type: "include",
					filter_key: "repo",
					filter_value: "alice/work-project",
				});
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "work-project", [makeGitHubCommit("work commit", "2024-01-15T14:00:00Z")]);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "personal-project", [makeGitHubCommit("personal commit", "2024-01-15T12:00:00Z")]);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_work.slug}/timeline`, {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(200);
				const data = (await res.json()) as ProfileTimelineResponse;
				expect(data.data.groups).toHaveLength(1);
				const items = flattenItems(data.data.groups);
				expect(items).toHaveLength(1);
				expect(items[0]?.platform).toBe("github");
				expect((items[0]?.payload as { repo: string }).repo).toBe("alice/work-project");
			});

			it.skip("multiple filters on same account work together", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
				await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
				await seedProfileFilter(ctx, PROFILES.alice_main.id, {
					account_id: ACCOUNTS.alice_github.id,
					filter_type: "include",
					filter_key: "repo",
					filter_value: "alice/project-a",
				});
				await seedProfileFilter(ctx, PROFILES.alice_main.id, {
					account_id: ACCOUNTS.alice_github.id,
					filter_type: "include",
					filter_key: "repo",
					filter_value: "alice/project-b",
				});
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "project-a", [makeGitHubCommit("commit to A", "2024-01-15T14:00:00Z")]);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "project-b", [makeGitHubCommit("commit to B", "2024-01-15T12:00:00Z")]);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "project-c", [makeGitHubCommit("commit to C", "2024-01-15T10:00:00Z")]);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.slug}/timeline`, {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(200);
				const data = (await res.json()) as ProfileTimelineResponse;
				expect(data.data.groups).toHaveLength(1);

				const items = flattenItems(data.data.groups);
				const repos = items.map(i => (i.payload as { repo: string }).repo);
				expect(repos).toContain("alice/project-a");
				expect(repos).toContain("alice/project-b");
				expect(repos).not.toContain("alice/project-c");
			});
		});

		describe("Edge cases", () => {
			it("returns empty timeline for profile with no accounts", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.slug}/timeline`, {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(200);
				const data = (await res.json()) as ProfileTimelineResponse;
				expect(data.data.groups).toHaveLength(0);
			});

			it("returns unfiltered timeline for profile with no filters", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
				await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
				await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_reddit);
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				await seedGitHubCommits(ctx, ACCOUNTS.alice_github.id, "alice", "project", [makeGitHubCommit("commit", "2024-01-15T14:00:00Z")]);

				await seedRedditPosts(ctx, ACCOUNTS.alice_reddit.id, "alice_redditor", [makeRedditPost("programming", "post", "2024-01-15T10:00:00Z")]);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.slug}/timeline`, {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(200);
				const data = (await res.json()) as ProfileTimelineResponse;
				expect(data.data.groups).toHaveLength(1);
				expect(data.data.groups[0]?.items).toHaveLength(2);
			});

			it("returns 404 for invalid profile slug", async () => {
				await seedUser(ctx, USERS.alice);
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				const app = createTestApp(ctx);
				const res = await app.request("/media/api/v1/profiles/nonexistent-profile/timeline", {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(404);
				const data = (await res.json()) as ErrorResponse;
				expect(data.error).toBe("Not found");
				expect(data.message).toContain("profile");
			});
		});

		describe("Authorization", () => {
			it("cannot access another user profile timeline", async () => {
				await seedUser(ctx, USERS.alice);
				await seedUser(ctx, USERS.bob);
				await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.bob_main.slug}/timeline`, {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(404);
				const data = (await res.json()) as ErrorResponse;
				expect(data.error).toBe("Not found");
			});

			it("requires authentication", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.slug}/timeline`);

				expect(res.status).toBe(401);
				const data = (await res.json()) as ErrorResponse;
				expect(data.error).toBe("Unauthorized");
			});

			it("returns 401 with invalid API key", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.slug}/timeline`, {
					headers: { Authorization: "Bearer invalid-api-key" },
				});

				expect(res.status).toBe(401);
				const data = (await res.json()) as ErrorResponse;
				expect(data.error).toBe("Unauthorized");
			});
		});

		describe("Timeline data handling", () => {
			it("returns empty groups when no data in stores", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
				await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				const app = createTestApp(ctx);
				const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.slug}/timeline`, {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				});

				expect(res.status).toBe(200);
				const data = (await res.json()) as ProfileTimelineResponse;
				expect(data.data.groups).toHaveLength(0);
			});
		});
	});
});
