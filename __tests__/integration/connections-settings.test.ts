import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ACCOUNTS, API_KEYS, GITHUB_FIXTURES, USERS } from "./fixtures";
import { type TestContext, createTestApp, createTestContext, seedAccount, seedApiKey, seedUser } from "./setup";

type ErrorResponse = { error: string; message: string };
type SettingsResponse = { settings: Record<string, unknown> };
type UpdateResponse = { updated: boolean };
type StatusUpdateResponse = { success: boolean; connection: Record<string, unknown> };
type ReposResponse = {
	repos: Array<{
		full_name: string;
		name: string;
		owner: string;
		is_private: boolean;
		default_branch: string;
		pushed_at: string | null;
	}>;
};

describe("Connection Settings API", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("PATCH /api/v1/connections/:account_id (status toggle)", () => {
		it("toggles connection to inactive", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}`, {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ is_active: false }),
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as StatusUpdateResponse;
			expect(data.success).toBe(true);
			expect(data.connection.is_active).toBe(false);
		});

		it("toggles connection to active", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, { ...ACCOUNTS.alice_github, is_active: false });
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}`, {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ is_active: true }),
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as StatusUpdateResponse;
			expect(data.success).toBe(true);
			expect(data.connection.is_active).toBe(true);
		});

		it("returns 404 for non-existent account", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/api/v1/connections/nonexistent", {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ is_active: false }),
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
		});

		it("returns 400 for invalid body", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}`, {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ is_active: "not-a-boolean" }),
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Bad request");
		});
	});

	describe("GET /api/v1/connections/:account_id/settings", () => {
		it("returns empty settings for new account", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}/settings`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as SettingsResponse;
			expect(data.settings).toEqual({});
		});

		it("returns 404 for non-existent account", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/api/v1/connections/nonexistent/settings", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
		});
	});

	describe("PUT /api/v1/connections/:account_id/settings", () => {
		it("creates settings for account", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);

			const res = await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}/settings`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					settings: {
						hidden_repos: ["alice/secret-repo"],
					},
				}),
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as UpdateResponse;
			expect(data.updated).toBe(true);

			const getRes = await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}/settings`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(getRes.status).toBe(200);
			const settings = (await getRes.json()) as SettingsResponse;
			expect(settings.settings.hidden_repos).toEqual(["alice/secret-repo"]);
		});

		it("updates existing settings", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);

			await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}/settings`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					settings: { hidden_repos: ["alice/old-repo"] },
				}),
			});

			const res = await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}/settings`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					settings: { hidden_repos: ["alice/new-repo", "alice/another-repo"] },
				}),
			});

			expect(res.status).toBe(200);

			const getRes = await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}/settings`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			const settings = (await getRes.json()) as SettingsResponse;
			expect(settings.settings.hidden_repos).toEqual(["alice/new-repo", "alice/another-repo"]);
		});

		it("returns 403 when member tries to update settings", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.shared_org_github);

			const timestamp = new Date().toISOString();
			await ctx.d1.prepare("INSERT INTO account_members (id, user_id, account_id, role, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), USERS.bob.id, ACCOUNTS.shared_org_github.id, "member", timestamp).run();

			await seedApiKey(ctx, USERS.bob.id, API_KEYS.bob_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.shared_org_github.id}/settings`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${API_KEYS.bob_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					settings: { hidden_repos: ["org/repo"] },
				}),
			});

			expect(res.status).toBe(403);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Forbidden");
		});

		it("returns 404 for non-existent account", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/api/v1/connections/nonexistent/settings", {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ settings: {} }),
			});

			expect(res.status).toBe(404);
		});
	});

	describe("GET /api/v1/connections with include_settings", () => {
		it("returns accounts with settings when include_settings=true", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);

			await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}/settings`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					settings: { hidden_repos: ["alice/hidden"] },
				}),
			});

			const res = await app.request("/api/v1/connections?include_settings=true", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as { accounts: Array<{ settings: Record<string, unknown> }> };
			expect(data.accounts[0]?.settings).toEqual({ hidden_repos: ["alice/hidden"] });
		});

		it("returns accounts without settings when include_settings is not set", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/api/v1/connections", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as { accounts: Array<Record<string, unknown>> };
			expect(data.accounts[0]).not.toHaveProperty("settings");
		});
	});

	describe("GET /api/v1/connections/:account_id/repos", () => {
		it("returns repos from GitHub meta store", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const metaData = {
				username: "alice",
				repositories: [
					{
						owner: "alice",
						name: "project-a",
						full_name: "alice/project-a",
						default_branch: "main",
						branches: ["main", "develop"],
						is_private: false,
						pushed_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
					},
					{
						owner: "alice",
						name: "project-b",
						full_name: "alice/project-b",
						default_branch: "main",
						branches: ["main"],
						is_private: true,
						pushed_at: null,
						updated_at: new Date().toISOString(),
					},
				],
				total_repos_available: 2,
				repos_fetched: 2,
				fetched_at: new Date().toISOString(),
			};

			const store = ctx.corpus.createGitHubMetaStore(ACCOUNTS.alice_github.id);
			await store.put(metaData);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}/repos`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as ReposResponse;
			expect(data.repos).toHaveLength(2);
			expect(data.repos[0]).toMatchObject({
				full_name: "alice/project-a",
				name: "project-a",
				owner: "alice",
				is_private: false,
				default_branch: "main",
			});
			expect(data.repos[1]).toMatchObject({
				full_name: "alice/project-b",
				name: "project-b",
				owner: "alice",
				is_private: true,
				default_branch: "main",
			});
		});

		it("returns empty array when no raw data exists", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}/repos`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as ReposResponse;
			expect(data.repos).toEqual([]);
		});

		it("returns 400 for non-GitHub account", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_bluesky);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.alice_bluesky.id}/repos`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Bad request");
			expect(data.message).toBe("Not a GitHub account");
		});

		it("returns 404 for non-existent account", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/api/v1/connections/nonexistent/repos", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
		});
	});
});
