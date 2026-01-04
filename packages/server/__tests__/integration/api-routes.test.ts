import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { accounts } from "@media/schema/database";
import { eq } from "drizzle-orm";
import { ACCOUNTS, API_KEYS, GITHUB_FIXTURES, PROFILES, USERS, makeTimelineItem } from "./fixtures";
import { type TestContext, createTestApp, createTestContext, seedAccount, seedApiKey, seedProfile, seedUser } from "./setup";

type TimelineData = {
	user_id: string;
	generated_at: string;
	groups: Array<{ date: string; items: unknown[] }>;
};

type ErrorResponse = { error: string; message: string };
type AccountResponse = { accounts: Array<{ account_id: string; platform: string }> };
type CreateConnectionResponse = { account_id: string };
type DeleteResponse = { deleted: boolean };

type TimelineResponse = {
	meta: { version: number; created_at: string };
	data: TimelineData;
};

type RawResponse = {
	meta: { version: number; created_at: string };
	data: unknown;
};

describe("API routes", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("authentication", () => {
		it("returns 401 when no Authorization header", async () => {
			await seedUser(ctx, USERS.alice);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/timeline/user-alice");

			expect(res.status).toBe(401);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Unauthorized");
			expect(data.message).toBe("Authentication required");
		});

		it("returns 401 when invalid API key", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/timeline/user-alice", {
				headers: { Authorization: "Bearer invalid-key-123" },
			});

			expect(res.status).toBe(401);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Unauthorized");
			expect(data.message).toBe("Authentication required");
		});

		it("returns 200 with valid API key", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const timelineData: TimelineData = {
				user_id: USERS.alice.id,
				generated_at: new Date().toISOString(),
				groups: [{ date: "2024-01-01", items: [makeTimelineItem()] }],
			};
			const store = ctx.corpus.createTimelineStore(USERS.alice.id);
			await store.put(timelineData);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/timeline/user-alice", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/v1/timeline/:user_id", () => {
		it("returns timeline for authenticated user", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const timelineData: TimelineData = {
				user_id: USERS.alice.id,
				generated_at: new Date().toISOString(),
				groups: [
					{ date: "2024-01-02", items: [makeTimelineItem({ title: "Commit 1" })] },
					{ date: "2024-01-01", items: [makeTimelineItem({ title: "Commit 2" })] },
				],
			};
			const store = ctx.corpus.createTimelineStore(USERS.alice.id);
			await store.put(timelineData);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/timeline/user-alice", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as TimelineResponse;
			expect(data.meta).toBeDefined();
			expect(data.data.groups).toHaveLength(2);
		});

		it("returns 403 when accessing other user timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/timeline/user-bob", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(403);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Forbidden");
			expect(data.message).toBe("Cannot access other user timelines");
		});

		it("returns 404 when no timeline exists", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/timeline/user-alice", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
			expect(data.message).toBe("Resource not found: timeline");
		});

		it("filters by date range with from/to params", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const timelineData: TimelineData = {
				user_id: USERS.alice.id,
				generated_at: new Date().toISOString(),
				groups: [
					{ date: "2024-01-05", items: [makeTimelineItem({ title: "Day 5" })] },
					{ date: "2024-01-04", items: [makeTimelineItem({ title: "Day 4" })] },
					{ date: "2024-01-03", items: [makeTimelineItem({ title: "Day 3" })] },
					{ date: "2024-01-02", items: [makeTimelineItem({ title: "Day 2" })] },
					{ date: "2024-01-01", items: [makeTimelineItem({ title: "Day 1" })] },
				],
			};
			const store = ctx.corpus.createTimelineStore(USERS.alice.id);
			await store.put(timelineData);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/timeline/user-alice?from=2024-01-02&to=2024-01-04", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as TimelineResponse;
			expect(data.data.groups).toHaveLength(3);
			expect(data.data.groups.map(g => g.date)).toEqual(["2024-01-04", "2024-01-03", "2024-01-02"]);
		});
	});

	describe("GET /api/v1/timeline/:user_id/raw/:platform", () => {
		it("returns raw platform data", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const rawData = GITHUB_FIXTURES.singleCommit();
			const store = ctx.corpus.createRawStore("github", ACCOUNTS.alice_github.id);
			await store.put(rawData);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/timeline/user-alice/raw/github?account_id=${ACCOUNTS.alice_github.id}`, { headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` } });

			expect(res.status).toBe(200);
			const data = (await res.json()) as RawResponse;
			expect(data.meta).toBeDefined();
			expect(data.data).toBeDefined();
		});

		it("returns 400 when account_id missing", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/timeline/user-alice/raw/github", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Bad request");
			expect(data.message).toBe("account_id query parameter required");
		});

		it("returns 404 when no raw data exists", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/timeline/user-alice/raw/github?account_id=nonexistent", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
			expect(data.message).toBe("Resource not found: raw_data");
		});
	});

	describe("GET /api/v1/connections", () => {
		it("returns user accounts", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_bluesky);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/connections?profile_id=${PROFILES.alice_main.id}`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as AccountResponse;
			expect(data.accounts).toHaveLength(2);
			expect(data.accounts.map(a => a.platform).sort()).toEqual(["bluesky", "github"]);
		});

		it("returns empty array for user with no accounts", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/connections?profile_id=${PROFILES.alice_main.id}`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as AccountResponse;
			expect(data.accounts).toHaveLength(0);
		});
	});

	describe("POST /api/v1/connections", () => {
		it("creates new account connection", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/connections", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					platform: "github",
					access_token: "ghp_test_token_123",
					profile_id: PROFILES.alice_main.id,
				}),
			});

			expect(res.status).toBe(201);
			const data = (await res.json()) as CreateConnectionResponse;
			expect(data.account_id).toBeDefined();

			const createdAccount = await ctx.drizzle.select().from(accounts).where(eq(accounts.id, data.account_id)).get();

			expect(createdAccount?.platform).toBe("github");
			expect(createdAccount?.access_token_encrypted).toBeDefined();
			expect(createdAccount?.profile_id).toBe(PROFILES.alice_main.id);
		});

		it("returns 400 when platform missing", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/connections", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ access_token: "ghp_test_token_123" }),
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Bad request");
		});

		it("returns 400 when access_token missing", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/connections", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ platform: "github" }),
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Bad request");
		});

		it("encrypts tokens before storing", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const plainToken = "ghp_plain_text_token_should_be_encrypted";

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/connections", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					platform: "github",
					access_token: plainToken,
					profile_id: PROFILES.alice_main.id,
				}),
			});

			expect(res.status).toBe(201);
			const data = (await res.json()) as CreateConnectionResponse;

			const account = await ctx.drizzle.select({ access_token_encrypted: accounts.access_token_encrypted }).from(accounts).where(eq(accounts.id, data.account_id)).get();

			expect(account?.access_token_encrypted).not.toBe(plainToken);
			expect(account?.access_token_encrypted).not.toContain(plainToken);
		});
	});

	describe("DELETE /api/v1/connections/:account_id", () => {
		it("fully deletes account and associated data when owner", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/connections/${ACCOUNTS.alice_github.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as { deleted: boolean; account_id: string; platform: string; deleted_stores: number };
			expect(data.deleted).toBe(true);
			expect(data.account_id).toBe(ACCOUNTS.alice_github.id);
			expect(data.platform).toBe("github");

			const account = await ctx.drizzle.select().from(accounts).where(eq(accounts.id, ACCOUNTS.alice_github.id)).get();
			expect(account).toBeUndefined();
		});

		it("returns 403 when user tries to delete account they don't own", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.bob.id, API_KEYS.bob_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/connections/${ACCOUNTS.alice_github.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.bob_primary}` },
			});

			expect(res.status).toBe(403);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Forbidden");
		});

		it("returns 404 when account not found", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/connections/nonexistent-account", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
			expect(data.message).toBe("Resource not found: account");
		});
	});

	describe("error response format", () => {
		const assertErrorFormat = (data: unknown): data is ErrorResponse => {
			const err = data as ErrorResponse;
			return typeof err.error === "string" && typeof err.message === "string";
		};

		it("all 400 errors have { error, message } format", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);

			const badRequests = [
				app.request("/media/api/v1/timeline/user-alice/raw/github", {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				}),
			];

			for (const req of badRequests) {
				const res = await req;
				expect(res.status).toBe(400);
				const data = await res.json();
				expect(assertErrorFormat(data)).toBe(true);
			}
		});

		it("all 401 errors have { error, message } format", async () => {
			const app = createTestApp(ctx);

			const unauthorizedRequests = [
				app.request("/media/api/v1/timeline/user-alice"),
				app.request("/media/api/v1/timeline/user-alice", {
					headers: { Authorization: "Bearer invalid-key" },
				}),
				app.request("/media/api/v1/connections"),
			];

			for (const req of unauthorizedRequests) {
				const res = await req;
				expect(res.status).toBe(401);
				const data = await res.json();
				expect(assertErrorFormat(data)).toBe(true);
			}
		});

		it("all 403 errors have { error, message } format", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);

			const forbiddenRequests = [
				app.request("/media/api/v1/timeline/user-bob", {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				}),
			];

			for (const req of forbiddenRequests) {
				const res = await req;
				expect(res.status).toBe(403);
				const data = await res.json();
				expect(assertErrorFormat(data)).toBe(true);
			}
		});

		it("all 404 errors have { error, message } format", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);

			const notFoundRequests = [
				app.request("/media/api/v1/timeline/user-alice", {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				}),
				app.request("/media/api/v1/timeline/user-alice/raw/github?account_id=nonexistent", {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				}),
				app.request("/media/api/v1/connections/nonexistent", {
					method: "DELETE",
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				}),
			];

			for (const req of notFoundRequests) {
				const res = await req;
				expect(res.status).toBe(404);
				const data = await res.json();
				expect(assertErrorFormat(data)).toBe(true);
			}
		});
	});
});
