import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { handleCron } from "../../src/cron";
import type { TimelineEntry } from "../../src/timeline";
import { ACCOUNTS, BLUESKY_FIXTURES, GITHUB_FIXTURES, PROFILES, USERS, makeGitHubExtendedCommit, makeGitHubRaw } from "./fixtures";
import { type TestContext, createGitHubProviderFromLegacyAccounts, createProviderFactoryFromAccounts, createTestContext, getUserAccounts, seedAccount, seedProfile, seedUser, setupGitHubProvider } from "./setup";

describe("multi-tenant", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("profile-based accounts", () => {
		it("account on profile appears in user timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			const githubData = makeGitHubRaw([makeGitHubExtendedCommit({ sha: "abc123", repo: "alice/project", message: "initial commit" })]);

			const gitHubProvider = createGitHubProviderFromLegacyAccounts({ [ACCOUNTS.alice_github.id]: githubData });
			await handleCron({ ...ctx.appContext, gitHubProvider });

			const aliceTimeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();

			expect(aliceTimeline.ok).toBe(true);
			if (aliceTimeline.ok) {
				const aliceData = aliceTimeline.value.data as { groups: Array<{ items: TimelineEntry[] }> };
				const aliceEntries = aliceData.groups.flatMap(g => g.items);
				expect(aliceEntries.length).toBeGreaterThan(0);
			}
		});

		it("multiple accounts on same profile are combined in timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_bluesky);

			const githubData = makeGitHubRaw([makeGitHubExtendedCommit({ repo: "alice/repo", message: "github commit" })]);

			const gitHubProvider = createGitHubProviderFromLegacyAccounts({ [ACCOUNTS.alice_github.id]: githubData });
			const providerFactory = createProviderFactoryFromAccounts({ [ACCOUNTS.alice_bluesky.id]: BLUESKY_FIXTURES.singlePost() });

			await handleCron({ ...ctx.appContext, gitHubProvider, providerFactory });

			const timeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			expect(timeline.ok).toBe(true);

			if (timeline.ok) {
				const data = timeline.value.data as { groups: Array<{ items: TimelineEntry[] }> };
				const entries = data.groups.flatMap(g => g.items);
				const hasGithub = entries.some(e => e.type === "commit_group" || (e.type === "commit" && e.platform === "github"));
				const hasBluesky = entries.some(e => e.type === "post" && e.platform === "bluesky");
				expect(hasGithub).toBe(true);
				expect(hasBluesky).toBe(true);
			}
		});

		it("user can have multiple profiles with different accounts", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_work);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.alice_work.id, ACCOUNTS.alice_bluesky);

			const accounts = await getUserAccounts(ctx, USERS.alice.id);
			expect(accounts.results).toHaveLength(2);
		});
	});

	describe("user isolation", () => {
		it("users cannot access other users timelines via corpus", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.bob_main.id, ACCOUNTS.bob_github);

			const gitHubProvider = createGitHubProviderFromLegacyAccounts({
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit("alice/repo"),
				[ACCOUNTS.bob_github.id]: GITHUB_FIXTURES.singleCommit("bob/repo"),
			});
			await handleCron({ ...ctx.appContext, gitHubProvider });

			const aliceStore = ctx.corpus.createTimelineStore(USERS.alice.id);
			const bobStore = ctx.corpus.createTimelineStore(USERS.bob.id);

			const aliceTimeline = await aliceStore.get_latest();
			const bobTimeline = await bobStore.get_latest();

			expect(aliceTimeline.ok).toBe(true);
			expect(bobTimeline.ok).toBe(true);

			if (aliceTimeline.ok && bobTimeline.ok) {
				expect((aliceTimeline.value.data as { user_id: string }).user_id).toBe(USERS.alice.id);
				expect((bobTimeline.value.data as { user_id: string }).user_id).toBe(USERS.bob.id);

				const aliceGroups = (aliceTimeline.value.data as { groups: Array<{ items: TimelineEntry[] }> }).groups;
				const bobGroups = (bobTimeline.value.data as { groups: Array<{ items: TimelineEntry[] }> }).groups;

				const aliceHasBobData = aliceGroups.flatMap(g => g.items).some(e => e.type === "commit_group" && e.repo.startsWith("bob/"));
				const bobHasAliceData = bobGroups.flatMap(g => g.items).some(e => e.type === "commit_group" && e.repo.startsWith("alice/"));

				expect(aliceHasBobData).toBe(false);
				expect(bobHasAliceData).toBe(false);
			}
		});

		it("user with no profile or accounts has no timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.charlie);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			const aliceData = GITHUB_FIXTURES.singleCommit("alice/private");
			const gitHubProvider = createGitHubProviderFromLegacyAccounts({ [ACCOUNTS.alice_github.id]: aliceData });
			await handleCron({ ...ctx.appContext, gitHubProvider });

			const charlieTimeline = await ctx.corpus.createTimelineStore(USERS.charlie.id).get_latest();
			expect(charlieTimeline.ok).toBe(false);
		});
	});

	describe("profile ownership", () => {
		it("account belongs to exactly one profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);

			const account = await ctx.d1.prepare("SELECT profile_id FROM media_accounts WHERE id = ?").bind(ACCOUNTS.alice_github.id).first<{ profile_id: string }>();
			expect(account?.profile_id).toBe(PROFILES.alice_main.id);
		});

		it("user sees all their accounts across profiles", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_work);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.alice_work.id, ACCOUNTS.alice_bluesky);

			const aliceAccounts = await getUserAccounts(ctx, USERS.alice.id);
			expect(aliceAccounts.results).toHaveLength(2);

			const typedAliceAccounts = aliceAccounts.results as Array<{ id: string }>;
			const accountIds = typedAliceAccounts.map(a => a.id).sort();
			expect(accountIds).toEqual([ACCOUNTS.alice_bluesky.id, ACCOUNTS.alice_github.id].sort());
		});
	});

	describe("multi-user scenarios", () => {
		it("each user gets their own separate timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.bob_main.id, ACCOUNTS.bob_github);

			const aliceData = makeGitHubRaw([makeGitHubExtendedCommit({ repo: "alice/personal", message: "alice work" })]);
			const bobData = makeGitHubRaw([makeGitHubExtendedCommit({ repo: "bob/personal", message: "bob work" })]);

			const gitHubProvider = createGitHubProviderFromLegacyAccounts({
				[ACCOUNTS.alice_github.id]: aliceData,
				[ACCOUNTS.bob_github.id]: bobData,
			});
			await handleCron({ ...ctx.appContext, gitHubProvider });

			const aliceTimeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			const bobTimeline = await ctx.corpus.createTimelineStore(USERS.bob.id).get_latest();

			expect(aliceTimeline.ok).toBe(true);
			expect(bobTimeline.ok).toBe(true);

			if (aliceTimeline.ok && bobTimeline.ok) {
				const aliceEntries = (aliceTimeline.value.data as { groups: Array<{ items: TimelineEntry[] }> }).groups.flatMap(g => g.items);
				const bobEntries = (bobTimeline.value.data as { groups: Array<{ items: TimelineEntry[] }> }).groups.flatMap(g => g.items);

				expect(aliceEntries.length).toBe(1);
				expect(bobEntries.length).toBe(1);

				const aliceRepos = aliceEntries.filter((e): e is TimelineEntry & { repo: string } => e.type === "commit_group").map(e => e.repo);
				expect(aliceRepos).toEqual(["alice/personal"]);

				const bobRepos = bobEntries.filter((e): e is TimelineEntry & { repo: string } => e.type === "commit_group").map(e => e.repo);
				expect(bobRepos).toEqual(["bob/personal"]);
			}
		});

		it("user with multiple platforms gets combined timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_bluesky);

			const aliceYoutube = { ...ACCOUNTS.bob_youtube, id: "acc-alice-youtube", access_token: "ya29_alice_yt_token" };
			await seedAccount(ctx, PROFILES.alice_main.id, aliceYoutube);

			const githubData = makeGitHubRaw([
				makeGitHubExtendedCommit({
					date: new Date(Date.now() - 3600000).toISOString(),
					repo: "alice/repo",
					message: "github commit",
				}),
			]);

			const gitHubProvider = createGitHubProviderFromLegacyAccounts({ [ACCOUNTS.alice_github.id]: githubData });
			await handleCron({ ...ctx.appContext, gitHubProvider });

			const timeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			expect(timeline.ok).toBe(true);

			if (timeline.ok) {
				const entries = (timeline.value.data as { groups: Array<{ entries: TimelineEntry[] }> }).groups.flatMap(g => g.entries);
				expect(entries.length).toBeGreaterThan(0);
			}
		});
	});
});
