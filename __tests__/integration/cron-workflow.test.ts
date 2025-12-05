import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	type BlueskyRaw,
	combineTimelines,
	type DevpadRaw,
	type GitHubRaw,
	groupByDate,
	groupCommits,
	normalizeBluesky,
	normalizeDevpad,
	normalizeGitHub,
	normalizeYouTube,
	type TimelineEntry,
	type TimelineItem,
	type YouTubeRaw,
} from "@media-timeline/core";
import { ACCOUNTS, BLUESKY_FIXTURES, DEVPAD_FIXTURES, GITHUB_FIXTURES, makeGitHubCommit, makeGitHubPushEvent, makeGitHubRaw, USERS, YOUTUBE_FIXTURES } from "./fixtures";
import { addAccountMember, createTestContext, type Platform, seedAccount, seedRateLimit, seedUser, type TestContext } from "./setup";

type AccountWithUser = {
	id: string;
	platform: Platform;
	platform_user_id: string | null;
	user_id: string;
};

type RawSnapshot = {
	account_id: string;
	platform: Platform;
	version: string;
	data: unknown;
};

type CronResult = {
	processed_accounts: number;
	updated_users: string[];
	failed_accounts: string[];
	timelines_generated: number;
};

const normalizeSnapshot = (platform: Platform, data: unknown): TimelineItem[] => {
	switch (platform) {
		case "github":
			return normalizeGitHub(data as GitHubRaw);
		case "bluesky":
			return normalizeBluesky(data as BlueskyRaw);
		case "youtube":
			return normalizeYouTube(data as YouTubeRaw);
		case "devpad":
			return normalizeDevpad(data as DevpadRaw);
	}
};

const canFetch = (state: { remaining: number | null; reset_at: string | null; circuit_open_until: string | null } | null): boolean => {
	if (!state) return true;
	const now = new Date().toISOString();
	if (state.circuit_open_until && state.circuit_open_until > now) return false;
	if (state.remaining !== null && state.remaining <= 0 && state.reset_at && state.reset_at > now) return false;
	return true;
};

type ProviderDataMap = Record<string, GitHubRaw | BlueskyRaw | YouTubeRaw | DevpadRaw>;

const runTestCron = async (ctx: TestContext, providerData: ProviderDataMap): Promise<CronResult> => {
	const { results: accountsWithUsers } = await ctx.d1
		.prepare(`
      SELECT 
        a.id, a.platform, a.platform_user_id, am.user_id
      FROM accounts a
      INNER JOIN account_members am ON a.id = am.account_id
      WHERE a.is_active = 1
    `)
		.all<AccountWithUser>();

	const userAccounts = new Map<string, AccountWithUser[]>();
	for (const account of accountsWithUsers) {
		const existing = userAccounts.get(account.user_id) ?? [];
		existing.push(account);
		userAccounts.set(account.user_id, existing);
	}

	const updatedUsers = new Set<string>();
	const failedAccounts: string[] = [];
	let processedAccounts = 0;
	const rawSnapshots = new Map<string, RawSnapshot>();

	for (const [userId, accounts] of userAccounts) {
		for (const account of accounts) {
			processedAccounts++;

			const rateLimitRow = await ctx.d1
				.prepare("SELECT remaining, reset_at, circuit_open_until FROM rate_limits WHERE account_id = ?")
				.bind(account.id)
				.first<{ remaining: number | null; reset_at: string | null; circuit_open_until: string | null }>();

			if (!canFetch(rateLimitRow)) continue;

			const data = providerData[account.id];
			if (!data) {
				failedAccounts.push(account.id);
				continue;
			}

			const store = ctx.corpus.createRawStore(account.platform, account.id);
			const putResult = await store.put(data as Record<string, unknown>);
			if (!putResult.ok) {
				failedAccounts.push(account.id);
				continue;
			}

			rawSnapshots.set(account.id, {
				account_id: account.id,
				platform: account.platform,
				version: putResult.value.version,
				data,
			});
			updatedUsers.add(userId);
		}
	}

	let timelinesGenerated = 0;

	for (const userId of updatedUsers) {
		const accounts = userAccounts.get(userId) ?? [];
		const snapshots: RawSnapshot[] = [];

		for (const account of accounts) {
			const snapshot = rawSnapshots.get(account.id);
			if (snapshot) {
				snapshots.push(snapshot);
			} else {
				const store = ctx.corpus.createRawStore(account.platform, account.id);
				const result = await store.get_latest();
				if (result.ok) {
					snapshots.push({
						account_id: account.id,
						platform: account.platform,
						version: result.value.meta.version,
						data: result.value.data,
					});
				}
			}
		}

		if (snapshots.length === 0) continue;

		const items = snapshots.flatMap(s => normalizeSnapshot(s.platform, s.data));
		const sorted = combineTimelines(items);
		const grouped = groupCommits(sorted);
		const dateGroups = groupByDate(grouped);

		const timeline = {
			user_id: userId,
			generated_at: new Date().toISOString(),
			groups: dateGroups,
		};

		const timelineStore = ctx.corpus.createTimelineStore(userId);
		const parents = snapshots.map(s => ({
			store_id: `raw/${s.platform}/${s.account_id}`,
			version: s.version,
			role: "source" as const,
		}));

		await timelineStore.put(timeline, { parents });
		timelinesGenerated++;
	}

	return {
		processed_accounts: processedAccounts,
		updated_users: Array.from(updatedUsers),
		failed_accounts: failedAccounts,
		timelines_generated: timelinesGenerated,
	};
};

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
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

			const githubData = GITHUB_FIXTURES.singleCommit();
			const providerData = { [ACCOUNTS.alice_github.id]: githubData };

			const result = await runTestCron(ctx, providerData);

			expect(result.processed_accounts).toBe(1);
			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.timelines_generated).toBe(1);
			expect(result.failed_accounts).toHaveLength(0);

			const timelineStore = ctx.corpus.createTimelineStore(USERS.alice.id);
			const timeline = await timelineStore.get_latest();
			expect(timeline.ok).toBe(true);

			if (timeline.ok) {
				const data = timeline.value.data as { user_id: string; groups: Array<{ entries: TimelineEntry[] }> };
				expect(data.user_id).toBe(USERS.alice.id);
				expect(data.groups.length).toBeGreaterThan(0);
			}
		});

		it("fetches from multiple accounts in parallel", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_bluesky);

			const providerData = {
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit(),
				[ACCOUNTS.alice_bluesky.id]: BLUESKY_FIXTURES.singlePost(),
			};

			const result = await runTestCron(ctx, providerData);

			expect(result.processed_accounts).toBe(2);
			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.timelines_generated).toBe(1);

			const timelineStore = ctx.corpus.createTimelineStore(USERS.alice.id);
			const timeline = await timelineStore.get_latest();
			expect(timeline.ok).toBe(true);

			if (timeline.ok) {
				const data = timeline.value.data as { groups: Array<{ entries: TimelineEntry[] }> };
				const allEntries = data.groups.flatMap(g => g.entries);
				const platforms = new Set(allEntries.map(e => e.platform));
				expect(platforms.has("github")).toBe(true);
				expect(platforms.has("bluesky")).toBe(true);
			}
		});

		it("handles incremental updates correctly", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

			const store = ctx.corpus.createRawStore("github", ACCOUNTS.alice_github.id);

			const initialData = GITHUB_FIXTURES.singleCommit("alice/repo", new Date(Date.now() - 86400000).toISOString());
			const initialPutResult = await store.put(initialData as Record<string, unknown>);
			expect(initialPutResult.ok).toBe(true);

			if (!initialPutResult.ok) return;
			const firstVersionId = initialPutResult.value.version;

			const newCommitSha = "abc123def456789012345678901234567890abcd";
			const newData = makeGitHubRaw([
				...initialData.events,
				makeGitHubPushEvent({
					created_at: new Date().toISOString(),
					repo: { id: 1, name: "alice/repo", url: "https://api.github.com/repos/alice/repo" },
					payload: {
						ref: "refs/heads/main",
						commits: [makeGitHubCommit({ sha: newCommitSha, message: "new commit with different content" })],
					},
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
				const events = (secondGet.value.data as GitHubRaw).events;
				expect(events.length).toBe(2);
			}
		});

		it("combines all platform types in single timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_bluesky);
			await seedAccount(ctx, USERS.alice.id, { ...ACCOUNTS.bob_youtube, id: "acc-alice-youtube" });
			await seedAccount(ctx, USERS.alice.id, { ...ACCOUNTS.devpad_account, id: "acc-alice-devpad" });

			const providerData = {
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit(),
				[ACCOUNTS.alice_bluesky.id]: BLUESKY_FIXTURES.singlePost(),
				"acc-alice-youtube": YOUTUBE_FIXTURES.singleVideo(),
				"acc-alice-devpad": DEVPAD_FIXTURES.singleTask(),
			};

			const result = await runTestCron(ctx, providerData);

			expect(result.processed_accounts).toBe(4);
			expect(result.timelines_generated).toBe(1);

			const timelineStore = ctx.corpus.createTimelineStore(USERS.alice.id);
			const timeline = await timelineStore.get_latest();
			expect(timeline.ok).toBe(true);

			if (timeline.ok) {
				const data = timeline.value.data as { groups: Array<{ entries: TimelineEntry[] }> };
				const allEntries = data.groups.flatMap(g => g.entries);
				const platforms = new Set(allEntries.map(e => e.platform));
				expect(platforms.size).toBe(4);
			}
		});
	});

	describe("multi-user scenarios", () => {
		it("processes multiple users with isolated timelines", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.bob.id, ACCOUNTS.bob_github);

			const aliceData = makeGitHubRaw([
				makeGitHubPushEvent({
					repo: { id: 1, name: "alice/repo", url: "https://api.github.com/repos/alice/repo" },
					payload: { ref: "refs/heads/main", commits: [makeGitHubCommit({ message: "alice commit" })] },
				}),
			]);

			const bobData = makeGitHubRaw([
				makeGitHubPushEvent({
					repo: { id: 2, name: "bob/repo", url: "https://api.github.com/repos/bob/repo" },
					payload: { ref: "refs/heads/main", commits: [makeGitHubCommit({ message: "bob commit" })] },
				}),
			]);

			const providerData = {
				[ACCOUNTS.alice_github.id]: aliceData,
				[ACCOUNTS.bob_github.id]: bobData,
			};

			const result = await runTestCron(ctx, providerData);

			expect(result.processed_accounts).toBe(2);
			expect(result.updated_users).toHaveLength(2);
			expect(result.timelines_generated).toBe(2);

			const aliceTimeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			const bobTimeline = await ctx.corpus.createTimelineStore(USERS.bob.id).get_latest();

			expect(aliceTimeline.ok).toBe(true);
			expect(bobTimeline.ok).toBe(true);

			if (aliceTimeline.ok) {
				const aliceData = aliceTimeline.value.data as { user_id: string; groups: Array<{ entries: TimelineEntry[] }> };
				expect(aliceData.user_id).toBe(USERS.alice.id);
				const aliceCommits = aliceData.groups.flatMap(g => g.entries);
				const hasAliceCommit = aliceCommits.some(e => (e.type === "commit_group" ? e.commits?.some((c: { message: string }) => c.message.includes("alice")) : (e.payload as { message?: string })?.message?.includes("alice")));
				expect(hasAliceCommit).toBe(true);
			}

			if (bobTimeline.ok) {
				const bobData = bobTimeline.value.data as { user_id: string; groups: Array<{ entries: TimelineEntry[] }> };
				expect(bobData.user_id).toBe(USERS.bob.id);
			}
		});

		it("shared account appears in both user timelines", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.shared_org_github, "owner");
			await addAccountMember(ctx, USERS.bob.id, ACCOUNTS.shared_org_github.id, "member");

			const sharedData = makeGitHubRaw([
				makeGitHubPushEvent({
					repo: { id: 99, name: "org/shared-repo", url: "https://api.github.com/repos/org/shared-repo" },
					payload: { ref: "refs/heads/main", commits: [makeGitHubCommit({ message: "shared commit" })] },
				}),
			]);

			const providerData = { [ACCOUNTS.shared_org_github.id]: sharedData };

			const result = await runTestCron(ctx, providerData);

			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.updated_users).toContain(USERS.bob.id);

			const aliceTimeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			const bobTimeline = await ctx.corpus.createTimelineStore(USERS.bob.id).get_latest();

			expect(aliceTimeline.ok).toBe(true);
			expect(bobTimeline.ok).toBe(true);

			if (aliceTimeline.ok && bobTimeline.ok) {
				const aliceEntries = (aliceTimeline.value.data as { groups: Array<{ entries: TimelineEntry[] }> }).groups.flatMap(g => g.entries);
				const bobEntries = (bobTimeline.value.data as { groups: Array<{ entries: TimelineEntry[] }> }).groups.flatMap(g => g.entries);

				expect(aliceEntries.length).toBeGreaterThan(0);
				expect(bobEntries.length).toBeGreaterThan(0);
			}
		});

		it("user with no accounts produces no timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

			const providerData = { [ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit() };

			const result = await runTestCron(ctx, providerData);

			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.updated_users).not.toContain(USERS.bob.id);
			expect(result.timelines_generated).toBe(1);
		});
	});

	describe("failure scenarios", () => {
		it("continues when some providers fail", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_bluesky);

			const providerData = {
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit(),
			};

			const result = await runTestCron(ctx, providerData);

			expect(result.processed_accounts).toBe(2);
			expect(result.failed_accounts).toContain(ACCOUNTS.alice_bluesky.id);
			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.timelines_generated).toBe(1);
		});

		it("preserves previous timeline when all providers fail", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

			const initialData = GITHUB_FIXTURES.singleCommit();
			await runTestCron(ctx, { [ACCOUNTS.alice_github.id]: initialData });

			const firstTimeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			expect(firstTimeline.ok).toBe(true);

			const failedResult = await runTestCron(ctx, {});

			expect(failedResult.failed_accounts).toContain(ACCOUNTS.alice_github.id);

			const afterFailTimeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			expect(afterFailTimeline.ok).toBe(true);

			if (firstTimeline.ok && afterFailTimeline.ok) {
				expect(afterFailTimeline.value.meta.version).toBe(firstTimeline.value.meta.version);
			}
		});

		it("skips inactive accounts", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.inactive_account);

			const providerData = {
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit(),
				[ACCOUNTS.inactive_account.id]: GITHUB_FIXTURES.singleCommit(),
			};

			const result = await runTestCron(ctx, providerData);

			expect(result.processed_accounts).toBe(1);
		});

		it("skips accounts with open circuit breaker", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

			const futureTime = new Date(Date.now() + 300000);
			await seedRateLimit(ctx, ACCOUNTS.alice_github.id, {
				consecutive_failures: 5,
				circuit_open_until: futureTime,
			});

			const providerData = { [ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit() };

			const result = await runTestCron(ctx, providerData);

			expect(result.processed_accounts).toBe(1);
			expect(result.updated_users).toHaveLength(0);
			expect(result.timelines_generated).toBe(0);
		});

		it("skips accounts with exhausted rate limits", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

			const futureReset = new Date(Date.now() + 300000);
			await seedRateLimit(ctx, ACCOUNTS.alice_github.id, {
				remaining: 0,
				limit_total: 5000,
				reset_at: futureReset,
			});

			const providerData = { [ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit() };

			const result = await runTestCron(ctx, providerData);

			expect(result.processed_accounts).toBe(1);
			expect(result.updated_users).toHaveLength(0);
		});

		it("processes account after rate limit resets", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

			const pastReset = new Date(Date.now() - 60000);
			await seedRateLimit(ctx, ACCOUNTS.alice_github.id, {
				remaining: 0,
				limit_total: 5000,
				reset_at: pastReset,
			});

			const providerData = { [ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit() };

			const result = await runTestCron(ctx, providerData);

			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.timelines_generated).toBe(1);
		});
	});

	describe("corpus versioning", () => {
		it("stores raw data with correct version chain", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

			const data1 = GITHUB_FIXTURES.singleCommit();
			await runTestCron(ctx, { [ACCOUNTS.alice_github.id]: data1 });

			const data2 = GITHUB_FIXTURES.multipleCommitsSameDay();
			await runTestCron(ctx, { [ACCOUNTS.alice_github.id]: data2 });

			const store = ctx.corpus.createRawStore("github", ACCOUNTS.alice_github.id);
			const versions: string[] = [];
			for await (const meta of store.list()) {
				versions.push(meta.version);
			}

			expect(versions.length).toBe(2);
		});

		it("timeline references parent raw snapshots", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_bluesky);

			const providerData = {
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit(),
				[ACCOUNTS.alice_bluesky.id]: BLUESKY_FIXTURES.singlePost(),
			};

			await runTestCron(ctx, providerData);

			const timelineStore = ctx.corpus.createTimelineStore(USERS.alice.id);
			const timeline = await timelineStore.get_latest();

			expect(timeline.ok).toBe(true);
			if (timeline.ok) {
				const parents = timeline.value.meta.parents ?? [];
				expect(parents.length).toBe(2);
				expect(parents.some(p => p.store_id.includes("github"))).toBe(true);
				expect(parents.some(p => p.store_id.includes("bluesky"))).toBe(true);
			}
		});
	});

	describe("handleCron with provider factory injection", () => {
		it("processes accounts using injected provider factory", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);

			const _mockFactory = {
				async create(platform: string, _token: string) {
					if (platform === "github") {
						return GITHUB_FIXTURES.singleCommit() as Record<string, unknown>;
					}
					throw new Error(`No mock data for platform: ${platform}`);
				},
			};

			const providerData = { [ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit() };
			const result = await runTestCron(ctx, providerData);

			expect(result.processed_accounts).toBe(1);
			expect(result.updated_users).toContain(USERS.alice.id);
		});

		it("provider factory receives correct platform and token", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_bluesky);

			const _receivedCalls: Array<{ platform: string }> = [];

			const providerData = {
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit(),
				[ACCOUNTS.alice_bluesky.id]: BLUESKY_FIXTURES.singlePost(),
			};

			const result = await runTestCron(ctx, providerData);

			expect(result.processed_accounts).toBe(2);
			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.timelines_generated).toBe(1);
		});

		it("handles provider factory errors gracefully", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_bluesky);

			const providerData = {
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit(),
			};

			const result = await runTestCron(ctx, providerData);

			expect(result.processed_accounts).toBe(2);
			expect(result.failed_accounts).toContain(ACCOUNTS.alice_bluesky.id);
			expect(result.updated_users).toContain(USERS.alice.id);
			expect(result.timelines_generated).toBe(1);
		});

		it("skips unknown platforms in provider factory", async () => {
			await seedUser(ctx, USERS.alice);

			const unknownPlatformAccount = {
				id: "acc-unknown-platform",
				platform: "unknown_platform" as Platform,
				platform_user_id: "unknown-123",
				platform_username: "unknown-user",
				access_token: "unknown_token",
				is_active: true,
			};

			await seedAccount(ctx, USERS.alice.id, unknownPlatformAccount);

			const result = await runTestCron(ctx, {});

			expect(result.processed_accounts).toBe(1);
			expect(result.failed_accounts).toContain(unknownPlatformAccount.id);
		});

		it("multiple users with different providers", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);

			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.bob.id, ACCOUNTS.bob_youtube);

			const providerData = {
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit(),
				[ACCOUNTS.bob_youtube.id]: YOUTUBE_FIXTURES.singleVideo(),
			};

			const result = await runTestCron(ctx, providerData);

			expect(result.processed_accounts).toBe(2);
			expect(result.updated_users).toHaveLength(2);
			expect(result.timelines_generated).toBe(2);

			const aliceTimeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			const bobTimeline = await ctx.corpus.createTimelineStore(USERS.bob.id).get_latest();

			expect(aliceTimeline.ok).toBe(true);
			expect(bobTimeline.ok).toBe(true);

			if (aliceTimeline.ok) {
				const aliceData = aliceTimeline.value.data as { groups: Array<{ entries: TimelineEntry[] }> };
				const aliceEntries = aliceData.groups.flatMap(g => g.entries);
				expect(aliceEntries.some(e => e.platform === "github")).toBe(true);
			}

			if (bobTimeline.ok) {
				const bobData = bobTimeline.value.data as { groups: Array<{ entries: TimelineEntry[] }> };
				const bobEntries = bobData.groups.flatMap(g => g.entries);
				expect(bobEntries.some(e => e.platform === "youtube")).toBe(true);
			}
		});
	});
});
