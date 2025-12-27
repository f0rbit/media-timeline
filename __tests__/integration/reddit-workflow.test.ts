import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { processRedditAccount } from "../../src/cron-reddit";
import { RedditMemoryProvider } from "../../src/platforms/reddit-memory";
import { loadRedditDataForAccount, normalizeReddit } from "../../src/timeline-reddit";
import { ACCOUNTS, makeRedditComment, makeRedditPost, REDDIT_FIXTURES, USERS } from "./fixtures";
import { createTestContext, seedAccount, seedUser, type TestContext } from "./setup";

describe("Reddit Integration", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("processRedditAccount", () => {
		it("should process a Reddit account with posts and comments", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_reddit);

			const provider = new RedditMemoryProvider({
				username: "testuser",
				posts: REDDIT_FIXTURES.multiplePosts(3),
				comments: REDDIT_FIXTURES.multipleComments(2),
			});

			const result = await processRedditAccount(ctx.corpus.backend, ACCOUNTS.alice_reddit.id, "fake-token", provider);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.stats.total_posts).toBe(3);
				expect(result.value.stats.total_comments).toBe(2);
				expect(result.value.stats.new_posts).toBe(3);
				expect(result.value.stats.new_comments).toBe(2);
			}
		});

		it("should merge new posts with existing", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_reddit);

			const provider = new RedditMemoryProvider({
				posts: [makeRedditPost({ id: "post1", title: "First Post" })],
				comments: [],
			});

			await processRedditAccount(ctx.corpus.backend, ACCOUNTS.alice_reddit.id, "token", provider);

			provider.setPosts([makeRedditPost({ id: "post1", title: "First Post" }), makeRedditPost({ id: "post2", title: "Second Post" })]);

			const result = await processRedditAccount(ctx.corpus.backend, ACCOUNTS.alice_reddit.id, "token", provider);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.stats.total_posts).toBe(2);
				expect(result.value.stats.new_posts).toBe(1);
			}
		});

		it("should merge new comments with existing", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_reddit);

			const provider = new RedditMemoryProvider({
				posts: [],
				comments: [makeRedditComment({ id: "comment1", body: "First comment" })],
			});

			await processRedditAccount(ctx.corpus.backend, ACCOUNTS.alice_reddit.id, "token", provider);

			provider.setComments([makeRedditComment({ id: "comment1", body: "First comment" }), makeRedditComment({ id: "comment2", body: "Second comment" })]);

			const result = await processRedditAccount(ctx.corpus.backend, ACCOUNTS.alice_reddit.id, "token", provider);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.stats.total_comments).toBe(2);
				expect(result.value.stats.new_comments).toBe(1);
			}
		});

		it("should update existing posts when they change", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_reddit);

			const provider = new RedditMemoryProvider({
				posts: [makeRedditPost({ id: "post1", title: "Original Title", score: 10 })],
				comments: [],
			});

			await processRedditAccount(ctx.corpus.backend, ACCOUNTS.alice_reddit.id, "token", provider);

			provider.setPosts([makeRedditPost({ id: "post1", title: "Original Title", score: 100 })]);

			const result = await processRedditAccount(ctx.corpus.backend, ACCOUNTS.alice_reddit.id, "token", provider);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.stats.total_posts).toBe(1);
				expect(result.value.stats.new_posts).toBe(0);
			}
		});

		it("should handle empty posts and comments", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_reddit);

			const provider = new RedditMemoryProvider({
				posts: [],
				comments: [],
			});

			const result = await processRedditAccount(ctx.corpus.backend, ACCOUNTS.alice_reddit.id, "token", provider);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.stats.total_posts).toBe(0);
				expect(result.value.stats.total_comments).toBe(0);
				expect(result.value.stats.new_posts).toBe(0);
				expect(result.value.stats.new_comments).toBe(0);
			}
		});

		it("should handle provider errors gracefully", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_reddit);

			const provider = new RedditMemoryProvider({});
			provider.setSimulateRateLimit(true);

			const result = await processRedditAccount(ctx.corpus.backend, ACCOUNTS.alice_reddit.id, "token", provider);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("fetch_failed");
			}
		});
	});

	describe("loadRedditDataForAccount", () => {
		it("should load posts and comments from storage", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_reddit);

			const provider = new RedditMemoryProvider({
				posts: REDDIT_FIXTURES.multiplePosts(2),
				comments: REDDIT_FIXTURES.multipleComments(3),
			});

			await processRedditAccount(ctx.corpus.backend, ACCOUNTS.alice_reddit.id, "token", provider);

			const data = await loadRedditDataForAccount(ctx.corpus.backend, ACCOUNTS.alice_reddit.id);

			expect(data.posts.length).toBe(2);
			expect(data.comments.length).toBe(3);
		});

		it("should return empty arrays when no data exists", async () => {
			const data = await loadRedditDataForAccount(ctx.corpus.backend, "nonexistent-account");

			expect(data.posts).toEqual([]);
			expect(data.comments).toEqual([]);
		});
	});

	describe("normalizeReddit", () => {
		it("should normalize posts to timeline items", () => {
			const posts = REDDIT_FIXTURES.multiplePosts(2);
			const items = normalizeReddit({ posts, comments: [] }, "testuser");

			expect(items.length).toBe(2);
			const first = items[0]!;
			expect(first.platform).toBe("reddit");
			expect(first.type).toBe("post");
			expect(first.payload.type).toBe("post");
		});

		it("should normalize comments to timeline items", () => {
			const comments = REDDIT_FIXTURES.multipleComments(2);
			const items = normalizeReddit({ posts: [], comments }, "testuser");

			expect(items.length).toBe(2);
			const first = items[0]!;
			expect(first.platform).toBe("reddit");
			expect(first.type).toBe("comment");
			expect(first.payload.type).toBe("comment");
		});

		it("should include subreddit info in comment payload", () => {
			const comments = [makeRedditComment({ subreddit: "programming" })];
			const items = normalizeReddit({ posts: [], comments }, "testuser");

			const first = items[0]!;
			expect(first.payload.type).toBe("comment");
			if (first.payload.type === "comment") {
				expect(first.payload.subreddit).toBe("programming");
			}
		});

		it("should set correct URLs for posts", () => {
			const posts = [makeRedditPost({ permalink: "/r/test/comments/abc123/my_post/" })];
			const items = normalizeReddit({ posts, comments: [] }, "testuser");

			expect(items[0]!.url).toBe("https://reddit.com/r/test/comments/abc123/my_post/");
		});

		it("should set correct URLs for comments", () => {
			const comments = [makeRedditComment({ permalink: "/r/test/comments/abc123/post/xyz789/" })];
			const items = normalizeReddit({ posts: [], comments }, "testuser");

			expect(items[0]!.url).toBe("https://reddit.com/r/test/comments/abc123/post/xyz789/");
		});

		it("should convert unix timestamps to ISO strings", () => {
			const timestamp = 1700000000;
			const posts = [makeRedditPost({ created_utc: timestamp })];
			const items = normalizeReddit({ posts, comments: [] }, "testuser");

			const expectedDate = new Date(timestamp * 1000).toISOString();
			expect(items[0]!.timestamp).toBe(expectedDate);
		});

		it("should handle self posts (text posts)", () => {
			const posts = [
				makeRedditPost({
					is_self: true,
					selftext: "This is the post content",
					url: "https://reddit.com/r/test/comments/abc/",
				}),
			];
			const items = normalizeReddit({ posts, comments: [] }, "testuser");

			const first = items[0]!;
			expect(first.payload.type).toBe("post");
			if (first.payload.type === "post") {
				expect(first.payload.content).toContain("This is the post content");
			}
		});

		it("should handle link posts", () => {
			const posts = [
				makeRedditPost({
					is_self: false,
					selftext: "",
					url: "https://example.com/external-link",
				}),
			];
			const items = normalizeReddit({ posts, comments: [] }, "testuser");

			const first = items[0]!;
			expect(first.payload.type).toBe("post");
			if (first.payload.type === "post") {
				expect(first.payload.content).toContain("https://example.com/external-link");
			}
		});

		it("should detect video posts", () => {
			const posts = [
				makeRedditPost({
					is_video: true,
					is_self: false,
				}),
			];
			const items = normalizeReddit({ posts, comments: [] }, "testuser");

			const first = items[0]!;
			expect(first.payload.type).toBe("post");
			if (first.payload.type === "post") {
				expect(first.payload.has_media).toBe(true);
			}
		});

		it("should include score in post payload", () => {
			const posts = [makeRedditPost({ score: 1234 })];
			const items = normalizeReddit({ posts, comments: [] }, "testuser");

			const first = items[0]!;
			if (first.payload.type === "post") {
				expect(first.payload.like_count).toBe(1234);
			}
		});

		it("should include num_comments in post payload", () => {
			const posts = [makeRedditPost({ num_comments: 42 })];
			const items = normalizeReddit({ posts, comments: [] }, "testuser");

			const first = items[0]!;
			if (first.payload.type === "post") {
				expect(first.payload.reply_count).toBe(42);
			}
		});

		it("should include score in comment payload", () => {
			const comments = [makeRedditComment({ score: 567 })];
			const items = normalizeReddit({ posts: [], comments }, "testuser");

			const first = items[0]!;
			if (first.payload.type === "comment") {
				expect(first.payload.score).toBe(567);
			}
		});

		it("should mark OP comments correctly", () => {
			const comments = [makeRedditComment({ is_submitter: true })];
			const items = normalizeReddit({ posts: [], comments }, "testuser");

			const first = items[0]!;
			if (first.payload.type === "comment") {
				expect(first.payload.is_op).toBe(true);
			}
		});

		it("should include parent post info in comment payload", () => {
			const comments = [
				makeRedditComment({
					link_title: "Parent Post Title",
					link_permalink: "/r/test/comments/abc/parent_post/",
				}),
			];
			const items = normalizeReddit({ posts: [], comments }, "testuser");

			const first = items[0]!;
			if (first.payload.type === "comment") {
				expect(first.payload.parent_title).toBe("Parent Post Title");
				expect(first.payload.parent_url).toBe("https://reddit.com/r/test/comments/abc/parent_post/");
			}
		});

		it("should truncate long comment bodies for title", () => {
			const longBody = "A".repeat(200);
			const comments = [makeRedditComment({ body: longBody })];
			const items = normalizeReddit({ posts: [], comments }, "testuser");

			const first = items[0]!;
			expect(first.title.length).toBeLessThanOrEqual(72);
			expect(first.title.endsWith("...")).toBe(true);
		});

		it("should combine posts and comments", () => {
			const posts = REDDIT_FIXTURES.multiplePosts(2);
			const comments = REDDIT_FIXTURES.multipleComments(3);
			const items = normalizeReddit({ posts, comments }, "testuser");

			expect(items.length).toBe(5);
			expect(items.filter(i => i.type === "post").length).toBe(2);
			expect(items.filter(i => i.type === "comment").length).toBe(3);
		});

		it("should handle empty input", () => {
			const items = normalizeReddit({ posts: [], comments: [] }, "testuser");
			expect(items).toEqual([]);
		});

		it("should generate unique IDs for items", () => {
			const posts = REDDIT_FIXTURES.multiplePosts(3);
			const comments = REDDIT_FIXTURES.multipleComments(2);
			const items = normalizeReddit({ posts, comments }, "testuser");

			const ids = new Set(items.map(i => i.id));
			expect(ids.size).toBe(items.length);
		});

		it("should prefix IDs with platform and type", () => {
			const posts = [makeRedditPost({ id: "abc123" })];
			const comments = [makeRedditComment({ id: "xyz789" })];
			const items = normalizeReddit({ posts, comments }, "testuser");

			expect(items[0]!.id).toBe("reddit:post:abc123");
			expect(items[1]!.id).toBe("reddit:comment:xyz789");
		});
	});

	describe("Reddit post variations", () => {
		it("should handle posts with different subreddits", () => {
			const posts = REDDIT_FIXTURES.postsWithSubreddits();
			const items = normalizeReddit({ posts, comments: [] }, "testuser");

			expect(items.length).toBe(3);
			const titles = items.map(i => i.title);
			expect(titles).toContain("Programming post");
			expect(titles).toContain("TypeScript post");
			expect(titles).toContain("Web dev post");
		});

		it("should handle NSFW posts", () => {
			const posts = REDDIT_FIXTURES.nsfwPost();
			const items = normalizeReddit({ posts, comments: [] }, "testuser");

			expect(items.length).toBe(1);
			expect(items[0]!.title).toBe("NSFW post");
		});

		it("should handle video posts", () => {
			const posts = REDDIT_FIXTURES.videoPost();
			const items = normalizeReddit({ posts, comments: [] }, "testuser");

			expect(items.length).toBe(1);
			const first = items[0]!;
			if (first.payload.type === "post") {
				expect(first.payload.has_media).toBe(true);
			}
		});

		it("should handle link posts", () => {
			const posts = REDDIT_FIXTURES.linkPost();
			const items = normalizeReddit({ posts, comments: [] }, "testuser");

			expect(items.length).toBe(1);
			const first = items[0]!;
			if (first.payload.type === "post") {
				expect(first.payload.content).toContain("https://example.com/article");
			}
		});
	});

	describe("Reddit comment variations", () => {
		it("should handle comments from different subreddits", () => {
			const comments = REDDIT_FIXTURES.commentsWithSubreddits();
			const items = normalizeReddit({ posts: [], comments }, "testuser");

			expect(items.length).toBe(2);
			const subreddits = items.map(i => {
				if (i.payload.type === "comment") {
					return i.payload.subreddit;
				}
				return null;
			});
			expect(subreddits).toContain("programming");
			expect(subreddits).toContain("typescript");
		});
	});
});
