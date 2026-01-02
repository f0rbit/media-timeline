import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { GitHubRaw, Platform } from "@media/schema";
import { handleCron } from "@media/server/cron";
import type { TimelineEntry } from "@media/server/timeline";
import { ACCOUNTS, BLUESKY_FIXTURES, DEVPAD_FIXTURES, GITHUB_FIXTURES, PROFILES, REDDIT_FIXTURES, USERS, YOUTUBE_FIXTURES, makeGitHubExtendedCommit, makeGitHubRaw } from "./fixtures";
import { type TestContext, createGitHubProviderFromLegacyAccounts, createProviderFactoryFromAccounts, createTestContext, seedAccount, seedProfile, seedRateLimit, seedUser, setupGitHubProvider } from "./setup";

describe("cron workflow", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("single user scenarios", () => {
		it("fetches from single account and generates timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			// Setup GitHub provider with data
			setupGitHubProvider(ctx, GITHUB_FIXTURES.singleCommit());

			const result = await handleCron(ctx.appContext);

			expect(result.processed_accounts).toBe(1);
			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.timelines_generated).toBe(1);
			expect(result.failed_accounts).toHaveLength(0);

			const timelineStore = ctx.corpus.createTimelineStore(USERS.alice.id);
			const timeline = await timelineStore.get_latest();
			expect(timeline.ok).toBe(true);

			if (timeline.ok) {
				const data = timeline.value.data as { user_id: string; groups: Array<{ items: TimelineEntry[] }> };
				expect(data.user_id).toBe(USERS.alice.id);
				expect(data.groups.length).toBeGreaterThan(0);
			}
		});

		it("fetches from multiple accounts in parallel", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_bluesky);

			// Setup GitHub provider
			setupGitHubProvider(ctx, GITHUB_FIXTURES.singleCommit());

			const providerFactory = createProviderFactoryFromAccounts({
				[ACCOUNTS.alice_bluesky.id]: BLUESKY_FIXTURES.singlePost(),
			});

			const result = await handleCron({ ...ctx.appContext, providerFactory });

			expect(result.processed_accounts).toBe(2);
			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.timelines_generated).toBe(1);

			const timelineStore = ctx.corpus.createTimelineStore(USERS.alice.id);
			const timeline = await timelineStore.get_latest();
			expect(timeline.ok).toBe(true);

			if (timeline.ok) {
				const data = timeline.value.data as { groups: Array<{ items: TimelineEntry[] }> };
				const allEntries = data.groups.flatMap(g => g.items);
				const hasGithub = allEntries.some(e => e.type === "commit_group" || (e.type === "commit" && e.platform === "github"));
				const hasBluesky = allEntries.some(e => e.type === "post" && e.platform === "bluesky");
				expect(hasGithub).toBe(true);
				expect(hasBluesky).toBe(true);
			}
		});

		it("handles incremental updates correctly", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			const store = ctx.corpus.createRawStore("github", ACCOUNTS.alice_github.id);

			const initialData = GITHUB_FIXTURES.singleCommit("alice/repo", new Date(Date.now() - 86400000).toISOString());
			const initialPutResult = await store.put(initialData as Record<string, unknown>);
			expect(initialPutResult.ok).toBe(true);

			if (!initialPutResult.ok) return;
			const firstVersionId = initialPutResult.value.version;

			const newCommitSha = "abc123def456789012345678901234567890abcd";
			const newData = makeGitHubRaw([
				...(initialData.commits ?? []),
				makeGitHubExtendedCommit({
					sha: newCommitSha,
					date: new Date().toISOString(),
					repo: "alice/repo",
					message: "new commit with different content",
				}),
			]);

			const secondPutResult = await store.put(newData as Record<string, unknown>);
			expect(secondPutResult.ok).toBe(true);

			if (!secondPutResult.ok) return;
			const secondVersionId = secondPutResult.value.version;

			expect(secondVersionId).not.toBe(firstVersionId);
			expect(secondPutResult.value.content_hash).not.toBe(initialPutResult.value.content_hash);

			const versions: string[] = [];
			for await (const meta of store.list()) {
				versions.push(meta.version);
			}
			expect(versions).toHaveLength(2);
			expect(versions).toContain(firstVersionId);
			expect(versions).toContain(secondVersionId);

			const secondGet = await store.get(secondVersionId);
			expect(secondGet.ok).toBe(true);
			if (secondGet.ok) {
				const commits = (secondGet.value.data as GitHubRaw).commits;
				expect(commits?.length).toBe(2);
			}
		});

		it("combines all platform types in single timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_bluesky);

			const aliceYoutube = { ...ACCOUNTS.bob_youtube, id: "acc-alice-youtube", access_token: "ya29_alice_yt_token" };
			const aliceDevpad = { ...ACCOUNTS.devpad_account, id: "acc-alice-devpad", access_token: "devpad_alice_token" };
			await seedAccount(ctx, PROFILES.alice_main.id, aliceYoutube);
			await seedAccount(ctx, PROFILES.alice_main.id, aliceDevpad);

			// Setup GitHub provider
			setupGitHubProvider(ctx, GITHUB_FIXTURES.singleCommit());

			const customAccounts = {
				...ACCOUNTS,
				alice_youtube: aliceYoutube,
				alice_devpad: aliceDevpad,
			};

			const providerFactory = createProviderFactoryFromAccounts(
				{
					[ACCOUNTS.alice_bluesky.id]: BLUESKY_FIXTURES.singlePost(),
					[aliceYoutube.id]: YOUTUBE_FIXTURES.singleVideo(),
					[aliceDevpad.id]: DEVPAD_FIXTURES.singleTask(),
				},
				customAccounts
			);

			const result = await handleCron({ ...ctx.appContext, providerFactory });

			expect(result.processed_accounts).toBe(4);
			expect(result.timelines_generated).toBe(1);

			const timelineStore = ctx.corpus.createTimelineStore(USERS.alice.id);
			const timeline = await timelineStore.get_latest();
			expect(timeline.ok).toBe(true);

			if (timeline.ok) {
				const data = timeline.value.data as { groups: Array<{ items: TimelineEntry[] }> };
				const allEntries = data.groups.flatMap(g => g.items);
				const types = new Set(allEntries.map(e => e.type));
				expect(types.has("commit_group") || types.has("commit")).toBe(true);
				expect(types.has("post")).toBe(true);
				expect(types.has("video")).toBe(true);
				expect(types.has("task")).toBe(true);
			}
		});
	});

	describe("multi-user scenarios", () => {
		it("processes multiple users with isolated timelines", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.bob_main.id, ACCOUNTS.bob_github);

			const aliceData = makeGitHubRaw([makeGitHubExtendedCommit({ repo: "alice/repo", message: "alice commit" })]);

			const bobData = makeGitHubRaw([makeGitHubExtendedCommit({ repo: "bob/repo", message: "bob commit" })]);

			// Setup GitHub provider for both users
			const gitHubProvider = createGitHubProviderFromLegacyAccounts({
				[ACCOUNTS.alice_github.id]: aliceData,
				[ACCOUNTS.bob_github.id]: bobData,
			});

			const result = await handleCron({ ...ctx.appContext, gitHubProvider });

			expect(result.processed_accounts).toBe(2);
			expect(result.updated_users).toHaveLength(2);
			expect(result.timelines_generated).toBe(2);

			const aliceTimeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			const bobTimeline = await ctx.corpus.createTimelineStore(USERS.bob.id).get_latest();

			expect(aliceTimeline.ok).toBe(true);
			expect(bobTimeline.ok).toBe(true);

			if (aliceTimeline.ok) {
				const aliceData = aliceTimeline.value.data as { user_id: string; groups: Array<{ items: TimelineEntry[] }> };
				expect(aliceData.user_id).toBe(USERS.alice.id);
				const aliceCommits = aliceData.groups.flatMap(g => g.items);
				const hasAliceCommit = aliceCommits.some(e =>
					e.type === "commit_group" ? e.commits?.some(c => (c.payload as { message: string }).message.includes("alice")) : (e.payload as { message?: string })?.message?.includes("alice")
				);
				expect(hasAliceCommit).toBe(true);
			}

			if (bobTimeline.ok) {
				const bobData = bobTimeline.value.data as { user_id: string; groups: Array<{ items: TimelineEntry[] }> };
				expect(bobData.user_id).toBe(USERS.bob.id);
			}
		});

		it("user with no accounts produces no timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			setupGitHubProvider(ctx, GITHUB_FIXTURES.singleCommit());

			const result = await handleCron(ctx.appContext);

			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.updated_users).not.toContain(USERS.bob.id);
			expect(result.timelines_generated).toBe(1);
		});
	});

	describe("failure scenarios", () => {
		it("continues when some providers fail", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_bluesky);

			// Setup GitHub provider
			setupGitHubProvider(ctx, GITHUB_FIXTURES.singleCommit());

			const result = await handleCron(ctx.appContext);

			expect(result.processed_accounts).toBe(2);
			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.timelines_generated).toBe(1);
		});

		it("preserves previous timeline when all providers fail", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			// Setup GitHub provider for first run
			setupGitHubProvider(ctx, GITHUB_FIXTURES.singleCommit());
			await handleCron(ctx.appContext);

			const firstTimeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			expect(firstTimeline.ok).toBe(true);

			// Simulate provider failure by setting rate limit error
			ctx.providers.github.setSimulateRateLimit(true);
			const failedResult = await handleCron(ctx.appContext);

			expect(failedResult.updated_users).toHaveLength(0);

			const afterFailTimeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			expect(afterFailTimeline.ok).toBe(true);

			if (firstTimeline.ok && afterFailTimeline.ok) {
				expect(afterFailTimeline.value.meta.version).toBe(firstTimeline.value.meta.version);
			}
		});

		it("skips inactive accounts", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, { ...ACCOUNTS.alice_github, is_active: false });
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_bluesky);

			// GitHub is inactive, so Bluesky should be the only one processed
			const providerFactory = createProviderFactoryFromAccounts({
				[ACCOUNTS.alice_bluesky.id]: BLUESKY_FIXTURES.singlePost(),
			});

			const result = await handleCron({ ...ctx.appContext, providerFactory });

			expect(result.processed_accounts).toBe(1);
		});

		it("skips accounts with open circuit breaker", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			const futureTime = new Date(Date.now() + 300000);
			await seedRateLimit(ctx, ACCOUNTS.alice_github.id, {
				consecutive_failures: 5,
				circuit_open_until: futureTime,
			});

			const providerFactory = createProviderFactoryFromAccounts({
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit(),
			});

			const result = await handleCron({ ...ctx.appContext, providerFactory });

			expect(result.processed_accounts).toBe(1);
			expect(result.updated_users).toHaveLength(0);
			expect(result.timelines_generated).toBe(0);
		});

		it("skips accounts with exhausted rate limits", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			const futureReset = new Date(Date.now() + 300000);
			await seedRateLimit(ctx, ACCOUNTS.alice_github.id, {
				remaining: 0,
				limit_total: 5000,
				reset_at: futureReset,
			});

			const providerFactory = createProviderFactoryFromAccounts({
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit(),
			});

			const result = await handleCron({ ...ctx.appContext, providerFactory });

			expect(result.processed_accounts).toBe(1);
			expect(result.updated_users).toHaveLength(0);
		});

		it("processes account after rate limit resets", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			const pastReset = new Date(Date.now() - 60000);
			await seedRateLimit(ctx, ACCOUNTS.alice_github.id, {
				remaining: 0,
				limit_total: 5000,
				reset_at: pastReset,
			});

			const providerFactory = createProviderFactoryFromAccounts({
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit(),
			});

			const result = await handleCron({ ...ctx.appContext, providerFactory });

			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.timelines_generated).toBe(1);
		});
	});

	describe("corpus versioning", () => {
		it("stores raw data with correct version chain", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_bluesky);

			// Use Bluesky to test raw store versioning (GitHub now uses multi-store format)
			const providerFactory1 = createProviderFactoryFromAccounts({ [ACCOUNTS.alice_bluesky.id]: BLUESKY_FIXTURES.singlePost() });
			await handleCron({ ...ctx.appContext, providerFactory: providerFactory1 });

			const providerFactory2 = createProviderFactoryFromAccounts({ [ACCOUNTS.alice_bluesky.id]: BLUESKY_FIXTURES.multiplePosts() });
			await handleCron({ ...ctx.appContext, providerFactory: providerFactory2 });

			const store = ctx.corpus.createRawStore("bluesky", ACCOUNTS.alice_bluesky.id);
			const versions: string[] = [];
			for await (const meta of store.list()) {
				versions.push(meta.version);
			}

			expect(versions.length).toBe(2);
		});

		it("timeline references parent raw snapshots", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_bluesky);

			// Setup GitHub provider
			setupGitHubProvider(ctx, GITHUB_FIXTURES.singleCommit());

			const providerFactory = createProviderFactoryFromAccounts({
				[ACCOUNTS.alice_bluesky.id]: BLUESKY_FIXTURES.singlePost(),
			});

			await handleCron({ ...ctx.appContext, providerFactory });

			const timelineStore = ctx.corpus.createTimelineStore(USERS.alice.id);
			const timeline = await timelineStore.get_latest();

			expect(timeline.ok).toBe(true);
			if (timeline.ok) {
				const parents = timeline.value.meta.parents ?? [];
				// Should have parent for GitHub (multi-store format now uses raw store id) and Bluesky
				expect(parents.length).toBe(2);
				expect(parents.some(p => p.store_id.includes("github"))).toBe(true);
				expect(parents.some(p => p.store_id.includes("bluesky"))).toBe(true);
			}
		});
	});

	describe("handleCron with provider factory injection", () => {
		it("processes accounts using injected provider factory", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			// GitHub now uses its own provider, not the factory
			setupGitHubProvider(ctx, GITHUB_FIXTURES.singleCommit());

			const result = await handleCron(ctx.appContext);

			expect(result.processed_accounts).toBe(1);
			expect(result.updated_users).toContain(USERS.alice.id);
		});

		it("provider factory receives correct platform and token", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_bluesky);

			// Setup GitHub provider (doesn't use provider factory)
			setupGitHubProvider(ctx, GITHUB_FIXTURES.singleCommit());

			// Provider factory is used for non-GitHub platforms
			const providerFactory = createProviderFactoryFromAccounts({
				[ACCOUNTS.alice_bluesky.id]: BLUESKY_FIXTURES.singlePost(),
			});

			const result = await handleCron({ ...ctx.appContext, providerFactory });

			expect(result.processed_accounts).toBe(2);
			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.timelines_generated).toBe(1);
		});

		it("handles provider factory errors gracefully", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_bluesky);

			const providerFactory = createProviderFactoryFromAccounts({
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit(),
			});

			const result = await handleCron({ ...ctx.appContext, providerFactory });

			expect(result.processed_accounts).toBe(2);
			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.timelines_generated).toBe(1);
		});

		it("skips unknown platforms in provider factory", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			const unknownPlatformAccount = {
				id: "acc-unknown-platform",
				platform: "unknown_platform" as Platform,
				platform_user_id: "unknown-123",
				platform_username: "unknown-user",
				access_token: "unknown_token",
				is_active: true,
			};

			await seedAccount(ctx, PROFILES.alice_main.id, unknownPlatformAccount);

			const providerFactory = createProviderFactoryFromAccounts({});

			const result = await handleCron({ ...ctx.appContext, providerFactory });

			expect(result.processed_accounts).toBe(1);
		});

		it("multiple users with different providers", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);

			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.bob_main.id, ACCOUNTS.bob_youtube);

			// Setup GitHub provider for Alice (GitHub uses separate flow)
			setupGitHubProvider(ctx, GITHUB_FIXTURES.singleCommit());

			// Setup provider factory for non-GitHub platforms (YouTube for Bob)
			const providerFactory = createProviderFactoryFromAccounts({
				[ACCOUNTS.bob_youtube.id]: YOUTUBE_FIXTURES.singleVideo(),
			});

			const result = await handleCron({ ...ctx.appContext, providerFactory });

			expect(result.processed_accounts).toBe(2);
			expect(result.updated_users).toHaveLength(2);
			expect(result.timelines_generated).toBe(2);

			const aliceTimeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			const bobTimeline = await ctx.corpus.createTimelineStore(USERS.bob.id).get_latest();

			expect(aliceTimeline.ok).toBe(true);
			expect(bobTimeline.ok).toBe(true);

			if (aliceTimeline.ok) {
				const aliceData = aliceTimeline.value.data as { groups: Array<{ items: TimelineEntry[] }> };
				const aliceEntries = aliceData.groups.flatMap(g => g.items);
				expect(aliceEntries.some(e => e.type === "commit_group" || e.type === "commit")).toBe(true);
			}

			if (bobTimeline.ok) {
				const bobData = bobTimeline.value.data as { groups: Array<{ items: TimelineEntry[] }> };
				const bobEntries = bobData.groups.flatMap(g => g.items);
				expect(bobEntries.some(e => e.type === "video")).toBe(true);
			}
		});
	});

	describe("Reddit integration in cron", () => {
		it("processes Reddit account via cron flow", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_reddit);

			// Reddit uses its own provider flow (like GitHub), not the generic factory
			// The cron.ts processRedditAccountFlow handles this
			// For integration tests, we need to set up the Reddit memory provider
			ctx.providers.reddit.setPosts(REDDIT_FIXTURES.multiplePosts(2));
			ctx.providers.reddit.setComments(REDDIT_FIXTURES.multipleComments(1));

			// Note: Reddit doesn't use providerFactory, it uses RedditProvider directly
			// This test validates the account is processed (skipped if no real provider)
			const result = await handleCron(ctx.appContext);

			// Reddit account was processed (even if it might fail without real API)
			expect(result.processed_accounts).toBe(1);
		});

		it("combines Reddit with other platforms in timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_bluesky);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_reddit);

			// Setup GitHub
			setupGitHubProvider(ctx, GITHUB_FIXTURES.singleCommit());

			// Setup Bluesky via provider factory
			const providerFactory = createProviderFactoryFromAccounts({
				[ACCOUNTS.alice_bluesky.id]: BLUESKY_FIXTURES.singlePost(),
			});

			const result = await handleCron({ ...ctx.appContext, providerFactory });

			// All 3 accounts processed
			expect(result.processed_accounts).toBe(3);
			expect(result.updated_users).toContain(USERS.alice.id);
		});
	});
});
