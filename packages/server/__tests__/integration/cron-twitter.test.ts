import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { TwitterTweetsStore } from "@media/schema";
import { type TwitterProcessResult, processTwitterAccount } from "@media/server/cron";
import { ACCOUNTS, PROFILES, TWITTER_FIXTURES, USERS, makeTwitterTweet } from "./fixtures";
import { type TestContext, createTestContext, seedAccount, seedProfile, seedUser } from "./setup";

const getLatestTweets = async (ctx: TestContext, accountId: string): Promise<TwitterTweetsStore | null> => {
	const store = ctx.corpus.createTwitterTweetsStore(accountId);
	const latestResult = await store.get_latest();
	if (!latestResult.ok) return null;
	return latestResult.value.data as TwitterTweetsStore;
};

describe("Twitter Cron Processing", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("processTwitterAccount", () => {
		it("processes Twitter account and stores tweets", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			ctx.providers.twitter.setTweets(TWITTER_FIXTURES.singleTweet());

			const result = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.account_id).toBe(ACCOUNTS.alice_twitter.id);
			expect(result.value.stats.total_tweets).toBe(1);
			expect(result.value.stats.new_tweets).toBe(1);
			expect(result.value.meta_version).not.toBe("");
			expect(result.value.tweets_version).not.toBe("");
		});

		it("stores multiple tweets and tracks stats", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			ctx.providers.twitter.setTweets(TWITTER_FIXTURES.multipleTweets(5));

			const result = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.stats.total_tweets).toBe(5);
			expect(result.value.stats.new_tweets).toBe(5);
		});

		it("merges new tweets with existing tweets", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			const existingTweets = [
				makeTwitterTweet({
					id: "existing-tweet-1",
					text: "Existing tweet 1",
					created_at: "2024-01-10T12:00:00Z",
				}),
				makeTwitterTweet({
					id: "existing-tweet-2",
					text: "Existing tweet 2",
					created_at: "2024-01-09T12:00:00Z",
				}),
			];

			ctx.providers.twitter.setTweets(existingTweets);
			await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			const newTweets = [
				makeTwitterTweet({
					id: "new-tweet-1",
					text: "New tweet 1",
					created_at: "2024-01-15T12:00:00Z",
				}),
				makeTwitterTweet({
					id: "existing-tweet-1",
					text: "Existing tweet 1",
					created_at: "2024-01-10T12:00:00Z",
				}),
			];

			ctx.providers.twitter.setTweets(newTweets);
			const result = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.stats.total_tweets).toBe(3);
			expect(result.value.stats.new_tweets).toBe(1);
		});

		it("deduplicates tweets by id", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			const duplicateTweets = [makeTwitterTweet({ id: "tweet-123", text: "Original text", created_at: "2024-01-15T12:00:00Z" }), makeTwitterTweet({ id: "tweet-456", text: "Another tweet", created_at: "2024-01-14T12:00:00Z" })];

			ctx.providers.twitter.setTweets(duplicateTweets);
			await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			const sameTweetsAgain = [makeTwitterTweet({ id: "tweet-123", text: "Original text", created_at: "2024-01-15T12:00:00Z" }), makeTwitterTweet({ id: "tweet-456", text: "Another tweet", created_at: "2024-01-14T12:00:00Z" })];

			ctx.providers.twitter.setTweets(sameTweetsAgain);
			const result = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.stats.total_tweets).toBe(2);
			expect(result.value.stats.new_tweets).toBe(0);
		});

		it("sorts tweets by created_at descending", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			const unsortedTweets = [
				makeTwitterTweet({ id: "tweet-old", text: "Old tweet", created_at: "2024-01-01T12:00:00Z" }),
				makeTwitterTweet({ id: "tweet-new", text: "New tweet", created_at: "2024-01-15T12:00:00Z" }),
				makeTwitterTweet({ id: "tweet-mid", text: "Mid tweet", created_at: "2024-01-10T12:00:00Z" }),
			];

			ctx.providers.twitter.setTweets(unsortedTweets);
			await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			const data = await getLatestTweets(ctx, ACCOUNTS.alice_twitter.id);
			expect(data).not.toBeNull();
			if (!data) return;

			expect(data.tweets[0]?.id).toBe("tweet-new");
			expect(data.tweets[1]?.id).toBe("tweet-mid");
			expect(data.tweets[2]?.id).toBe("tweet-old");
		});

		it("handles empty tweet list", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			ctx.providers.twitter.setTweets([]);

			const result = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.stats.total_tweets).toBe(0);
			expect(result.value.stats.new_tweets).toBe(0);
		});

		it("stores tweet with media attachments", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			ctx.providers.twitter.setTweets(TWITTER_FIXTURES.withMedia());
			ctx.providers.twitter.setMedia([
				{
					media_key: "media_1",
					type: "photo",
					url: "https://pbs.twimg.com/media/test.jpg",
				},
			]);

			const result = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const data = await getLatestTweets(ctx, ACCOUNTS.alice_twitter.id);
			expect(data).not.toBeNull();
			if (!data) return;

			expect(data.media).toHaveLength(1);
			expect(data.media[0]?.media_key).toBe("media_1");
		});

		it("handles tweets with retweets", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			ctx.providers.twitter.setTweets(TWITTER_FIXTURES.withRetweet());

			const result = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.stats.total_tweets).toBe(1);

			const data = await getLatestTweets(ctx, ACCOUNTS.alice_twitter.id);
			expect(data).not.toBeNull();
			if (!data) return;

			const tweet = data.tweets[0];
			expect(tweet?.referenced_tweets).toBeDefined();
			expect(tweet?.referenced_tweets?.[0]?.type).toBe("retweeted");
		});

		it("handles tweets with replies", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			ctx.providers.twitter.setTweets(TWITTER_FIXTURES.withReply());

			const result = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const data = await getLatestTweets(ctx, ACCOUNTS.alice_twitter.id);
			expect(data).not.toBeNull();
			if (!data) return;

			const tweet = data.tweets[0];
			expect(tweet?.in_reply_to_user_id).toBeDefined();
			expect(tweet?.referenced_tweets?.[0]?.type).toBe("replied_to");
		});

		it("preserves sensitive tweet flag", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			ctx.providers.twitter.setTweets(TWITTER_FIXTURES.sensitive());

			const result = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const data = await getLatestTweets(ctx, ACCOUNTS.alice_twitter.id);
			expect(data).not.toBeNull();
			if (!data) return;

			const tweet = data.tweets[0];
			expect(tweet?.possibly_sensitive).toBe(true);
		});
	});

	describe("Error handling", () => {
		it("returns error on rate limit", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			ctx.providers.twitter.setSimulateRateLimit(true);

			const result = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result.ok).toBe(false);
			if (result.ok) return;

			expect(result.error.kind).toBe("fetch_failed");
		});

		it("returns error on auth expired", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			ctx.providers.twitter.setSimulateAuthExpired(true);

			const result = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result.ok).toBe(false);
			if (result.ok) return;

			expect(result.error.kind).toBe("fetch_failed");
		});

		it("increments call count on each fetch", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			ctx.providers.twitter.setTweets(TWITTER_FIXTURES.singleTweet());

			expect(ctx.providers.twitter.getCallCount()).toBe(0);

			await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(ctx.providers.twitter.getCallCount()).toBe(1);

			await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(ctx.providers.twitter.getCallCount()).toBe(2);
		});
	});

	describe("Incremental updates", () => {
		it("accumulates tweets across multiple fetches", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			const oldTweets = [makeTwitterTweet({ id: "oldest-tweet", text: "Oldest", created_at: "2024-01-01T12:00:00Z" })];

			ctx.providers.twitter.setTweets(oldTweets);
			const result1 = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result1.ok).toBe(true);
			if (!result1.ok) return;
			expect(result1.value.stats.total_tweets).toBe(1);
			expect(result1.value.stats.new_tweets).toBe(1);

			const newTweets = [makeTwitterTweet({ id: "newest-tweet", text: "Newest", created_at: "2024-01-15T12:00:00Z" })];

			ctx.providers.twitter.setTweets(newTweets);
			const result2 = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result2.ok).toBe(true);
			if (!result2.ok) return;
			expect(result2.value.stats.total_tweets).toBe(2);
			expect(result2.value.stats.new_tweets).toBe(1);
		});

		it("tracks correct new count when fetching overlapping tweets", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			const initialTweets = [makeTwitterTweet({ id: "initial-tweet", text: "Initial", created_at: "2024-01-10T12:00:00Z" })];

			ctx.providers.twitter.setTweets(initialTweets);
			await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			const newerTweets = [makeTwitterTweet({ id: "newer-tweet", text: "Newer", created_at: "2024-01-15T12:00:00Z" }), makeTwitterTweet({ id: "initial-tweet", text: "Initial", created_at: "2024-01-10T12:00:00Z" })];

			ctx.providers.twitter.setTweets(newerTweets);
			const result = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.stats.total_tweets).toBe(2);
			expect(result.value.stats.new_tweets).toBe(1);
		});
	});

	describe("Store versioning", () => {
		it("creates new version on each successful fetch", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			ctx.providers.twitter.setTweets([makeTwitterTweet({ id: "tweet-1", text: "First tweet", created_at: "2024-01-10T12:00:00Z" })]);

			const result1 = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result1.ok).toBe(true);
			if (!result1.ok) return;

			const version1 = result1.value.tweets_version;

			ctx.providers.twitter.setTweets([makeTwitterTweet({ id: "tweet-2", text: "Second tweet", created_at: "2024-01-15T12:00:00Z" })]);

			const result2 = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			expect(result2.ok).toBe(true);
			if (!result2.ok) return;

			const version2 = result2.value.tweets_version;

			expect(version1).not.toBe(version2);
		});

		it("version history is accessible", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			ctx.providers.twitter.setTweets([makeTwitterTweet({ id: "tweet-1", created_at: "2024-01-10T12:00:00Z" })]);
			await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			ctx.providers.twitter.setTweets([makeTwitterTweet({ id: "tweet-2", created_at: "2024-01-15T12:00:00Z" })]);
			await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			const store = ctx.corpus.createTwitterTweetsStore(ACCOUNTS.alice_twitter.id);

			const versions: string[] = [];
			for await (const meta of store.list()) {
				versions.push(meta.version);
			}

			expect(versions.length).toBe(2);
		});
	});

	describe("Multi-account scenarios", () => {
		it("processes multiple Twitter accounts independently", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_twitter);

			const bobTwitter = {
				...ACCOUNTS.alice_twitter,
				id: "acc-bob-twitter",
				platform_user_id: "twitter-bob-456",
				platform_username: "bob_tweeter",
				access_token: "twitter_bob_token",
			};
			await seedAccount(ctx, PROFILES.bob_main.id, bobTwitter);

			ctx.providers.twitter.setTweets([makeTwitterTweet({ id: "alice-tweet", text: "Alice tweet" })]);

			const aliceResult = await processTwitterAccount(ctx.appContext.backend, ACCOUNTS.alice_twitter.id, ACCOUNTS.alice_twitter.access_token, ctx.providers.twitter);

			ctx.providers.twitter.setTweets([makeTwitterTweet({ id: "bob-tweet-1", text: "Bob tweet 1" }), makeTwitterTweet({ id: "bob-tweet-2", text: "Bob tweet 2" })]);

			const bobResult = await processTwitterAccount(ctx.appContext.backend, bobTwitter.id, bobTwitter.access_token, ctx.providers.twitter);

			expect(aliceResult.ok).toBe(true);
			expect(bobResult.ok).toBe(true);

			if (!aliceResult.ok || !bobResult.ok) return;

			expect(aliceResult.value.stats.total_tweets).toBe(1);
			expect(bobResult.value.stats.total_tweets).toBe(2);

			const aliceData = await getLatestTweets(ctx, ACCOUNTS.alice_twitter.id);
			const bobData = await getLatestTweets(ctx, bobTwitter.id);

			expect(aliceData).not.toBeNull();
			expect(bobData).not.toBeNull();

			if (!aliceData || !bobData) return;

			expect(aliceData.tweets[0]?.id).toBe("alice-tweet");
			expect(bobData.tweets.some(t => t.id === "bob-tweet-1")).toBe(true);
		});
	});
});
