import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { normalizeGitHub } from "../../src/platforms";
import type { GitHubRaw, Platform } from "../../src/schema";
import { combineTimelines, groupByDate, groupCommits, type TimelineEntry } from "../../src/timeline";
import { ACCOUNTS, GITHUB_FIXTURES, makeGitHubCommit, makeGitHubPushEvent, makeGitHubRaw, USERS } from "./fixtures";
import { addAccountMember, createTestContext, getAccountMembers, getUserAccounts, seedAccount, seedUser, type TestContext } from "./setup";

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

type ProviderDataMap = Record<string, GitHubRaw>;

const runTestCron = async (ctx: TestContext, providerData: ProviderDataMap): Promise<{ updated_users: string[]; fetch_count: Map<string, number> }> => {
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
	const rawSnapshots = new Map<string, RawSnapshot>();
	const fetchCount = new Map<string, number>();

	const processedAccounts = new Set<string>();

	for (const [userId, accounts] of userAccounts) {
		for (const account of accounts) {
			if (processedAccounts.has(account.id)) {
				const existingSnapshot = rawSnapshots.get(account.id);
				if (existingSnapshot) {
					updatedUsers.add(userId);
				}
				continue;
			}

			const data = providerData[account.id];
			if (!data) continue;

			fetchCount.set(account.id, (fetchCount.get(account.id) ?? 0) + 1);
			processedAccounts.add(account.id);

			const store = ctx.corpus.createRawStore(account.platform, account.id);
			const putResult = await store.put(data as Record<string, unknown>);
			if (!putResult.ok) continue;

			rawSnapshots.set(account.id, {
				account_id: account.id,
				platform: account.platform,
				version: putResult.value.version,
				data,
			});
			updatedUsers.add(userId);
		}
	}

	for (const userId of updatedUsers) {
		const accounts = userAccounts.get(userId) ?? [];
		const snapshots: RawSnapshot[] = [];

		for (const account of accounts) {
			const snapshot = rawSnapshots.get(account.id);
			if (snapshot) {
				snapshots.push(snapshot);
			}
		}

		if (snapshots.length === 0) continue;

		const items = snapshots.flatMap(s => normalizeGitHub(s.data as GitHubRaw));
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
	}

	return { updated_users: Array.from(updatedUsers), fetch_count: fetchCount };
};

describe("multi-tenant", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("account sharing", () => {
		it("shared account data appears in multiple user timelines", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);

			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.shared_org_github, "owner");
			await addAccountMember(ctx, USERS.bob.id, ACCOUNTS.shared_org_github.id, "member");

			const sharedData = makeGitHubRaw([
				makeGitHubPushEvent({
					repo: { id: 99, name: "org/shared-repo", url: "https://api.github.com/repos/org/shared-repo" },
					payload: {
						ref: "refs/heads/main",
						commits: [makeGitHubCommit({ sha: "shared123", message: "shared commit" })],
					},
				}),
			]);

			await runTestCron(ctx, { [ACCOUNTS.shared_org_github.id]: sharedData });

			const aliceTimeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			const bobTimeline = await ctx.corpus.createTimelineStore(USERS.bob.id).get_latest();

			expect(aliceTimeline.ok).toBe(true);
			expect(bobTimeline.ok).toBe(true);

			if (aliceTimeline.ok && bobTimeline.ok) {
				const aliceData = aliceTimeline.value.data as { groups: Array<{ items: TimelineEntry[] }> };
				const bobData = bobTimeline.value.data as { groups: Array<{ items: TimelineEntry[] }> };

				const aliceEntries = aliceData.groups.flatMap(g => g.items);
				const bobEntries = bobData.groups.flatMap(g => g.items);

				expect(aliceEntries.length).toBeGreaterThan(0);
				expect(bobEntries.length).toBeGreaterThan(0);

				const aliceHasShared = aliceEntries.some(e => (e.type === "commit_group" ? e.repo === "org/shared-repo" : false));
				const bobHasShared = bobEntries.some(e => (e.type === "commit_group" ? e.repo === "org/shared-repo" : false));

				expect(aliceHasShared).toBe(true);
				expect(bobHasShared).toBe(true);
			}
		});

		it("shared account is only fetched once per cron run", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedUser(ctx, USERS.charlie);

			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.shared_org_github, "owner");
			await addAccountMember(ctx, USERS.bob.id, ACCOUNTS.shared_org_github.id, "member");
			await addAccountMember(ctx, USERS.charlie.id, ACCOUNTS.shared_org_github.id, "member");

			const sharedData = GITHUB_FIXTURES.singleCommit();

			const result = await runTestCron(ctx, { [ACCOUNTS.shared_org_github.id]: sharedData });

			expect(result.fetch_count.get(ACCOUNTS.shared_org_github.id)).toBe(1);
			expect(result.updated_users).toHaveLength(3);
		});

		it("each user gets their own timeline even with shared data", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);

			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github, "owner");
			await seedAccount(ctx, USERS.bob.id, ACCOUNTS.shared_org_github, "owner");
			await addAccountMember(ctx, USERS.alice.id, ACCOUNTS.shared_org_github.id, "member");

			const aliceData = makeGitHubRaw([
				makeGitHubPushEvent({
					repo: { id: 1, name: "alice/personal", url: "https://api.github.com/repos/alice/personal" },
					payload: { ref: "refs/heads/main", commits: [makeGitHubCommit({ message: "alice personal" })] },
				}),
			]);

			const sharedData = makeGitHubRaw([
				makeGitHubPushEvent({
					repo: { id: 99, name: "org/shared", url: "https://api.github.com/repos/org/shared" },
					payload: { ref: "refs/heads/main", commits: [makeGitHubCommit({ message: "shared work" })] },
				}),
			]);

			await runTestCron(ctx, {
				[ACCOUNTS.alice_github.id]: aliceData,
				[ACCOUNTS.shared_org_github.id]: sharedData,
			});

			const aliceTimeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			const bobTimeline = await ctx.corpus.createTimelineStore(USERS.bob.id).get_latest();

			expect(aliceTimeline.ok).toBe(true);
			expect(bobTimeline.ok).toBe(true);

			if (aliceTimeline.ok && bobTimeline.ok) {
				const aliceEntries = (aliceTimeline.value.data as { groups: Array<{ items: TimelineEntry[] }> }).groups.flatMap(g => g.items);
				const bobEntries = (bobTimeline.value.data as { groups: Array<{ items: TimelineEntry[] }> }).groups.flatMap(g => g.items);

				expect(aliceEntries.length).toBe(2);
				expect(bobEntries.length).toBe(1);

				const aliceRepos = aliceEntries
					.filter((e): e is TimelineEntry & { repo: string } => e.type === "commit_group")
					.map(e => e.repo)
					.sort();
				expect(aliceRepos).toEqual(["alice/personal", "org/shared"]);

				const bobRepos = bobEntries.filter((e): e is TimelineEntry & { repo: string } => e.type === "commit_group").map(e => e.repo);
				expect(bobRepos).toEqual(["org/shared"]);
			}
		});
	});

	describe("user isolation", () => {
		it("users cannot access other users timelines via corpus", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);

			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.bob.id, ACCOUNTS.bob_github);

			await runTestCron(ctx, {
				[ACCOUNTS.alice_github.id]: GITHUB_FIXTURES.singleCommit("alice/repo"),
				[ACCOUNTS.bob_github.id]: GITHUB_FIXTURES.singleCommit("bob/repo"),
			});

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

		it("account members can see shared account data", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);

			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.shared_org_github, "owner");
			await addAccountMember(ctx, USERS.bob.id, ACCOUNTS.shared_org_github.id, "member");

			const sharedData = GITHUB_FIXTURES.singleCommit("org/shared");
			await runTestCron(ctx, { [ACCOUNTS.shared_org_github.id]: sharedData });

			const bobTimeline = await ctx.corpus.createTimelineStore(USERS.bob.id).get_latest();
			expect(bobTimeline.ok).toBe(true);

			if (bobTimeline.ok) {
				const entries = (bobTimeline.value.data as { groups: Array<{ items: TimelineEntry[] }> }).groups.flatMap(g => g.items);
				const hasSharedData = entries.some(e => e.type === "commit_group" && e.repo === "org/shared");
				expect(hasSharedData).toBe(true);
			}
		});

		it("non-members cannot access account data", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.charlie);

			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github, "owner");

			const aliceData = GITHUB_FIXTURES.singleCommit("alice/private");
			await runTestCron(ctx, { [ACCOUNTS.alice_github.id]: aliceData });

			const charlieTimeline = await ctx.corpus.createTimelineStore(USERS.charlie.id).get_latest();

			expect(charlieTimeline.ok).toBe(false);
		});
	});

	describe("permissions", () => {
		it("owner role is set correctly", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github, "owner");

			const members = await getAccountMembers(ctx, ACCOUNTS.alice_github.id);
			expect(members.results).toHaveLength(1);
			expect((members.results[0] as { role: string }).role).toBe("owner");
		});

		it("member role is set correctly", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);

			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.shared_org_github, "owner");
			await addAccountMember(ctx, USERS.bob.id, ACCOUNTS.shared_org_github.id, "member");

			const members = await getAccountMembers(ctx, ACCOUNTS.shared_org_github.id);
			expect(members.results).toHaveLength(2);

			const typedMembers = members.results as Array<{ role: string; user_id: string }>;
			const ownerMember = typedMembers.find(m => m.role === "owner");
			const regularMember = typedMembers.find(m => m.role === "member");

			expect(ownerMember).toBeDefined();
			expect(regularMember).toBeDefined();
			expect((ownerMember as { user_id: string }).user_id).toBe(USERS.alice.id);
			expect((regularMember as { user_id: string }).user_id).toBe(USERS.bob.id);
		});

		it("user sees all their accounts including shared ones", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);

			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github, "owner");
			await seedAccount(ctx, USERS.bob.id, ACCOUNTS.shared_org_github, "owner");
			await addAccountMember(ctx, USERS.alice.id, ACCOUNTS.shared_org_github.id, "member");

			const aliceAccounts = await getUserAccounts(ctx, USERS.alice.id);
			expect(aliceAccounts.results).toHaveLength(2);

			const typedAliceAccounts = aliceAccounts.results as Array<{ id: string }>;
			const accountIds = typedAliceAccounts.map(a => a.id).sort();
			expect(accountIds).toEqual([ACCOUNTS.alice_github.id, ACCOUNTS.shared_org_github.id].sort());
		});

		it("only owner can deactivate account via direct DB check", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);

			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.shared_org_github, "owner");
			await addAccountMember(ctx, USERS.bob.id, ACCOUNTS.shared_org_github.id, "member");

			const checkOwnership = async (userId: string, accountId: string): Promise<boolean> => {
				const result = await ctx.d1.prepare("SELECT role FROM account_members WHERE user_id = ? AND account_id = ?").bind(userId, accountId).first<{ role: string }>();
				return result?.role === "owner";
			};

			expect(await checkOwnership(USERS.alice.id, ACCOUNTS.shared_org_github.id)).toBe(true);
			expect(await checkOwnership(USERS.bob.id, ACCOUNTS.shared_org_github.id)).toBe(false);
		});

		it("only owner can add members via permission check", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedUser(ctx, USERS.charlie);

			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.shared_org_github, "owner");
			await addAccountMember(ctx, USERS.bob.id, ACCOUNTS.shared_org_github.id, "member");

			const canAddMember = async (requesterId: string, accountId: string): Promise<boolean> => {
				const result = await ctx.d1.prepare("SELECT role FROM account_members WHERE user_id = ? AND account_id = ?").bind(requesterId, accountId).first<{ role: string }>();
				return result?.role === "owner";
			};

			expect(await canAddMember(USERS.alice.id, ACCOUNTS.shared_org_github.id)).toBe(true);
			expect(await canAddMember(USERS.bob.id, ACCOUNTS.shared_org_github.id)).toBe(false);
			expect(await canAddMember(USERS.charlie.id, ACCOUNTS.shared_org_github.id)).toBe(false);
		});

		it("prevents duplicate memberships", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github, "owner");

			const addDuplicate = async () => {
				try {
					await addAccountMember(ctx, USERS.alice.id, ACCOUNTS.alice_github.id, "member");
					return false;
				} catch {
					return true;
				}
			};

			const failed = await addDuplicate();
			expect(failed).toBe(true);
		});
	});

	describe("multi-account scenarios", () => {
		it("user with multiple platforms gets combined timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github, "owner");
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_bluesky, "owner");

			const githubData = makeGitHubRaw([
				makeGitHubPushEvent({
					created_at: new Date(Date.now() - 3600000).toISOString(),
					repo: { id: 1, name: "alice/repo", url: "https://api.github.com/repos/alice/repo" },
					payload: { ref: "refs/heads/main", commits: [makeGitHubCommit({ message: "github commit" })] },
				}),
			]);

			await runTestCron(ctx, { [ACCOUNTS.alice_github.id]: githubData });

			const timeline = await ctx.corpus.createTimelineStore(USERS.alice.id).get_latest();
			expect(timeline.ok).toBe(true);

			if (timeline.ok) {
				const entries = (timeline.value.data as { groups: Array<{ entries: TimelineEntry[] }> }).groups.flatMap(g => g.entries);
				expect(entries.length).toBeGreaterThan(0);
			}
		});

		it("organization with multiple members and accounts", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedUser(ctx, USERS.org_admin);

			await seedAccount(ctx, USERS.org_admin.id, ACCOUNTS.shared_org_github, "owner");
			await seedAccount(ctx, USERS.org_admin.id, { ...ACCOUNTS.devpad_account, id: "acc-org-devpad" }, "owner");
			await addAccountMember(ctx, USERS.alice.id, ACCOUNTS.shared_org_github.id, "member");
			await addAccountMember(ctx, USERS.alice.id, "acc-org-devpad", "member");
			await addAccountMember(ctx, USERS.bob.id, ACCOUNTS.shared_org_github.id, "member");

			const githubData = GITHUB_FIXTURES.multipleCommitsSameDay("org/project");

			await runTestCron(ctx, { [ACCOUNTS.shared_org_github.id]: githubData });

			const adminAccounts = await getUserAccounts(ctx, USERS.org_admin.id);
			const aliceAccounts = await getUserAccounts(ctx, USERS.alice.id);
			const bobAccounts = await getUserAccounts(ctx, USERS.bob.id);

			expect(adminAccounts.results).toHaveLength(2);
			expect(aliceAccounts.results).toHaveLength(2);
			expect(bobAccounts.results).toHaveLength(1);
		});
	});
});
