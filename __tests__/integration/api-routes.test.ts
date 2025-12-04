import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { ACCOUNTS, API_KEYS, GITHUB_FIXTURES, makeTimelineItem, USERS } from "./fixtures";
import { addAccountMember, createTestContext, seedAccount, seedUser, type TestContext, type TestEnv } from "./setup";

type Bindings = TestEnv;

type TimelineData = {
	user_id: string;
	generated_at: string;
	groups: Array<{ date: string; items: unknown[] }>;
};

type ErrorResponse = { error: string; message: string };
type AccountResponse = { accounts: Array<{ account_id: string; platform: string; role: string }> };
type CreateConnectionResponse = { account_id: string; role: string };
type DeleteResponse = { deleted: boolean };
type AddMemberResponse = { member_id: string; role: string };

const createTimelineRoutesWithEnv = (env: Bindings) => {
	const app = new Hono();

	app.use("*", async (c, next) => {
		const authHeader = c.req.header("Authorization");
		if (!authHeader?.startsWith("Bearer ")) {
			return c.json({ error: "Unauthorized", message: "Missing or invalid Authorization header" }, 401);
		}

		const apiKey = authHeader.slice(7);
		if (!apiKey) {
			return c.json({ error: "Unauthorized", message: "API key required" }, 401);
		}

		const keyHash = await hashApiKeyHex(apiKey);
		const result = await env.DB.prepare("SELECT id, user_id FROM api_keys WHERE key_hash = ?").bind(keyHash).first<{ id: string; user_id: string }>();

		if (!result) {
			return c.json({ error: "Unauthorized", message: "Invalid API key" }, 401);
		}

		await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), result.id).run();

		c.set("auth", { user_id: result.user_id, key_id: result.id });
		await next();
	});

	app.get("/:user_id", async c => {
		const userId = c.req.param("user_id");
		const auth = c.get("auth") as { user_id: string };

		if (auth.user_id !== userId) {
			return c.json({ error: "Forbidden", message: "Cannot access other user timelines" }, 403);
		}

		const from = c.req.query("from");
		const to = c.req.query("to");

		const timelineData = await env.BUCKET.get(`timeline/${userId}/latest.json`);
		if (!timelineData) {
			return c.json({ error: "Not found", message: "No timeline data available" }, 404);
		}

		const buffer = await timelineData.arrayBuffer();
		const timeline = JSON.parse(new TextDecoder().decode(buffer)) as TimelineData;

		if (!from && !to) {
			return c.json({ data: timeline });
		}

		const filteredGroups = timeline.groups.filter(group => {
			if (from && group.date < from) return false;
			if (to && group.date > to) return false;
			return true;
		});

		return c.json({ data: { ...timeline, groups: filteredGroups } });
	});

	app.get("/:user_id/raw/:platform", async c => {
		const userId = c.req.param("user_id");
		const platform = c.req.param("platform");
		const auth = c.get("auth") as { user_id: string };

		if (auth.user_id !== userId) {
			return c.json({ error: "Forbidden", message: "Cannot access other user data" }, 403);
		}

		const accountId = c.req.query("account_id");
		if (!accountId) {
			return c.json({ error: "Bad request", message: "account_id query parameter required" }, 400);
		}

		const rawData = await env.BUCKET.get(`raw/${platform}/${accountId}/latest.json`);
		if (!rawData) {
			return c.json({ error: "Not found", message: "No raw data available for this account" }, 404);
		}

		const buffer = await rawData.arrayBuffer();
		const data = JSON.parse(new TextDecoder().decode(buffer));
		return c.json({ data });
	});

	return app;
};

const createConnectionRoutesWithEnv = (env: Bindings) => {
	const app = new Hono();

	app.use("*", async (c, next) => {
		const authHeader = c.req.header("Authorization");
		if (!authHeader?.startsWith("Bearer ")) {
			return c.json({ error: "Unauthorized", message: "Missing or invalid Authorization header" }, 401);
		}

		const apiKey = authHeader.slice(7);
		if (!apiKey) {
			return c.json({ error: "Unauthorized", message: "API key required" }, 401);
		}

		const keyHash = await hashApiKeyHex(apiKey);
		const result = await env.DB.prepare("SELECT id, user_id FROM api_keys WHERE key_hash = ?").bind(keyHash).first<{ id: string; user_id: string }>();

		if (!result) {
			return c.json({ error: "Unauthorized", message: "Invalid API key" }, 401);
		}

		c.set("auth", { user_id: result.user_id, key_id: result.id });
		await next();
	});

	app.get("/", async c => {
		const auth = c.get("auth") as { user_id: string };

		const { results } = await env.DB.prepare(`
        SELECT 
          a.id as account_id,
          a.platform,
          a.platform_username,
          a.is_active,
          a.last_fetched_at,
          am.role,
          am.created_at
        FROM account_members am
        INNER JOIN accounts a ON am.account_id = a.id
        WHERE am.user_id = ?
      `)
			.bind(auth.user_id)
			.all<{ account_id: string; platform: string; role: string }>();

		return c.json({ accounts: results });
	});

	app.post("/", async c => {
		const auth = c.get("auth") as { user_id: string };
		const body = await c.req.json<{ platform?: string; access_token?: string; refresh_token?: string }>();

		if (!body.platform) {
			return c.json({ error: "Bad request", message: "platform and access_token required" }, 400);
		}

		if (!body.access_token) {
			return c.json({ error: "Bad request", message: "platform and access_token required" }, 400);
		}

		const now = new Date().toISOString();
		const accountId = crypto.randomUUID();
		const memberId = crypto.randomUUID();

		const encryptedAccessToken = await encryptForTest(body.access_token, env.ENCRYPTION_KEY);
		const encryptedRefreshToken = body.refresh_token ? await encryptForTest(body.refresh_token, env.ENCRYPTION_KEY) : null;

		await env.DB.batch([
			env.DB.prepare(`
          INSERT INTO accounts (id, platform, access_token_encrypted, refresh_token_encrypted, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?)
        `).bind(accountId, body.platform, encryptedAccessToken, encryptedRefreshToken, now, now),
			env.DB.prepare(`
          INSERT INTO account_members (id, user_id, account_id, role, created_at)
          VALUES (?, ?, ?, 'owner', ?)
        `).bind(memberId, auth.user_id, accountId, now),
		]);

		return c.json({ account_id: accountId, role: "owner" }, 201);
	});

	app.delete("/:account_id", async c => {
		const auth = c.get("auth") as { user_id: string };
		const accountId = c.req.param("account_id");

		const membership = await env.DB.prepare("SELECT role FROM account_members WHERE user_id = ? AND account_id = ?").bind(auth.user_id, accountId).first<{ role: string }>();

		if (!membership) {
			return c.json({ error: "Not found", message: "Account not found" }, 404);
		}

		if (membership.role !== "owner") {
			return c.json({ error: "Forbidden", message: "Only owners can delete accounts" }, 403);
		}

		const now = new Date().toISOString();
		await env.DB.prepare("UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?").bind(now, accountId).run();

		return c.json({ deleted: true });
	});

	app.post("/:account_id/members", async c => {
		const auth = c.get("auth") as { user_id: string };
		const accountId = c.req.param("account_id");
		const body = await c.req.json<{ user_id?: string }>();

		if (!body.user_id) {
			return c.json({ error: "Bad request", message: "user_id required" }, 400);
		}

		const membership = await env.DB.prepare("SELECT role FROM account_members WHERE user_id = ? AND account_id = ?").bind(auth.user_id, accountId).first<{ role: string }>();

		if (!membership) {
			return c.json({ error: "Not found", message: "Account not found" }, 404);
		}

		if (membership.role !== "owner") {
			return c.json({ error: "Forbidden", message: "Only owners can add members" }, 403);
		}

		const existingMember = await env.DB.prepare("SELECT id FROM account_members WHERE user_id = ? AND account_id = ?").bind(body.user_id, accountId).first<{ id: string }>();

		if (existingMember) {
			return c.json({ error: "Conflict", message: "User is already a member" }, 409);
		}

		const memberId = crypto.randomUUID();
		const now = new Date().toISOString();

		await env.DB.prepare("INSERT INTO account_members (id, user_id, account_id, role, created_at) VALUES (?, ?, ?, ?, ?)").bind(memberId, body.user_id, accountId, "member", now).run();

		return c.json({ member_id: memberId, role: "member" }, 201);
	});

	return app;
};

const hashApiKeyHex = async (key: string): Promise<string> => {
	const encoder = new TextEncoder();
	const data = encoder.encode(key);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(hashBuffer))
		.map(b => b.toString(16).padStart(2, "0"))
		.join("");
};

const encryptForTest = async (text: string, key: string): Promise<string> => {
	const encoder = new TextEncoder();
	const keyData = encoder.encode(key.padEnd(32, "0").slice(0, 32));
	const cryptoKey = await crypto.subtle.importKey("raw", keyData, "AES-GCM", false, ["encrypt"]);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoder.encode(text));
	const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
	combined.set(iv);
	combined.set(new Uint8Array(encrypted), iv.length);
	return btoa(String.fromCharCode(...combined));
};

const createTestApp = (env: Bindings) => {
	const timelineApp = createTimelineRoutesWithEnv(env);
	const connectionApp = createConnectionRoutesWithEnv(env);

	const app = new Hono();

	app.route("/api/v1/timeline", timelineApp);
	app.route("/api/v1/connections", connectionApp);

	app.notFound(c => c.json({ error: "Not found", path: c.req.path }, 404));

	return app;
};

const storeTimelineData = async (ctx: TestContext, userId: string, data: TimelineData): Promise<void> => {
	const json = JSON.stringify(data);
	await ctx.r2.put(`timeline/${userId}/latest.json`, json);
};

const storeRawData = async (ctx: TestContext, platform: string, accountId: string, data: unknown): Promise<void> => {
	const json = JSON.stringify(data);
	await ctx.r2.put(`raw/${platform}/${accountId}/latest.json`, json);
};

const seedApiKeyHex = async (ctx: TestContext, userId: string, keyValue: string, name?: string): Promise<string> => {
	const keyId = crypto.randomUUID();
	const keyHash = await hashApiKeyHex(keyValue);
	const timestamp = new Date().toISOString();

	await ctx.d1
		.prepare("INSERT INTO api_keys (id, user_id, key_hash, name, created_at) VALUES (?, ?, ?, ?, ?)")
		.bind(keyId, userId, keyHash, name ?? null, timestamp)
		.run();

	return keyId;
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

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/timeline/user-alice");

			expect(res.status).toBe(401);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Unauthorized");
			expect(data.message).toBe("Missing or invalid Authorization header");
		});

		it("returns 401 when invalid API key", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/timeline/user-alice", {
				headers: { Authorization: "Bearer invalid-key-123" },
			});

			expect(res.status).toBe(401);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Unauthorized");
			expect(data.message).toBe("Invalid API key");
		});

		it("returns 200 with valid API key", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const timelineData: TimelineData = {
				user_id: USERS.alice.id,
				generated_at: new Date().toISOString(),
				groups: [{ date: "2024-01-01", items: [makeTimelineItem()] }],
			};
			await storeTimelineData(ctx, USERS.alice.id, timelineData);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/timeline/user-alice", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/v1/timeline/:user_id", () => {
		it("returns timeline for authenticated user", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const timelineData: TimelineData = {
				user_id: USERS.alice.id,
				generated_at: new Date().toISOString(),
				groups: [
					{ date: "2024-01-02", items: [makeTimelineItem({ title: "Commit 1" })] },
					{ date: "2024-01-01", items: [makeTimelineItem({ title: "Commit 2" })] },
				],
			};
			await storeTimelineData(ctx, USERS.alice.id, timelineData);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/timeline/user-alice", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as { data: TimelineData };
			expect(data.data.user_id).toBe(USERS.alice.id);
			expect(data.data.groups).toHaveLength(2);
		});

		it("returns 403 when accessing other user timeline", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/timeline/user-bob", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(403);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Forbidden");
			expect(data.message).toBe("Cannot access other user timelines");
		});

		it("returns 404 when no timeline exists", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/timeline/user-alice", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
			expect(data.message).toBe("No timeline data available");
		});

		it("filters by date range with from/to params", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

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
			await storeTimelineData(ctx, USERS.alice.id, timelineData);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/timeline/user-alice?from=2024-01-02&to=2024-01-04", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as { data: TimelineData };
			expect(data.data.groups).toHaveLength(3);
			expect(data.data.groups.map(g => g.date)).toEqual(["2024-01-04", "2024-01-03", "2024-01-02"]);
		});
	});

	describe("GET /api/v1/timeline/:user_id/raw/:platform", () => {
		it("returns raw platform data", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const rawData = GITHUB_FIXTURES.singleCommit();
			await storeRawData(ctx, "github", ACCOUNTS.alice_github.id, rawData);

			const app = createTestApp(ctx.env);
			const res = await app.request(`/api/v1/timeline/user-alice/raw/github?account_id=${ACCOUNTS.alice_github.id}`, { headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` } });

			expect(res.status).toBe(200);
			const data = (await res.json()) as { data: unknown };
			expect(data.data).toBeDefined();
		});

		it("returns 400 when account_id missing", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/timeline/user-alice/raw/github", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Bad request");
			expect(data.message).toBe("account_id query parameter required");
		});

		it("returns 404 when no raw data exists", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/timeline/user-alice/raw/github?account_id=nonexistent", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
			expect(data.message).toBe("No raw data available for this account");
		});
	});

	describe("GET /api/v1/connections", () => {
		it("returns user accounts", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_bluesky);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/connections", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as AccountResponse;
			expect(data.accounts).toHaveLength(2);
			expect(data.accounts.map(a => a.platform).sort()).toEqual(["bluesky", "github"]);
		});

		it("returns empty array for user with no accounts", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/connections", {
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
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/connections", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					platform: "github",
					access_token: "ghp_test_token_123",
				}),
			});

			expect(res.status).toBe(201);
			const data = (await res.json()) as CreateConnectionResponse;
			expect(data.account_id).toBeDefined();
			expect(data.role).toBe("owner");

			const accounts = await ctx.d1.prepare("SELECT * FROM accounts WHERE id = ?").bind(data.account_id).first<{ platform: string; access_token_encrypted: string }>();

			expect(accounts?.platform).toBe("github");
			expect(accounts?.access_token_encrypted).toBeDefined();
		});

		it("returns 400 when platform missing", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/connections", {
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
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/connections", {
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
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const plainToken = "ghp_plain_text_token_should_be_encrypted";

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/connections", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					platform: "github",
					access_token: plainToken,
				}),
			});

			expect(res.status).toBe(201);
			const data = (await res.json()) as CreateConnectionResponse;

			const account = await ctx.d1.prepare("SELECT access_token_encrypted FROM accounts WHERE id = ?").bind(data.account_id).first<{ access_token_encrypted: string }>();

			expect(account?.access_token_encrypted).not.toBe(plainToken);
			expect(account?.access_token_encrypted).not.toContain(plainToken);
		});
	});

	describe("DELETE /api/v1/connections/:account_id", () => {
		it("deactivates account when owner", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as DeleteResponse;
			expect(data.deleted).toBe(true);

			const account = await ctx.d1.prepare("SELECT is_active FROM accounts WHERE id = ?").bind(ACCOUNTS.alice_github.id).first<{ is_active: number }>();

			expect(account?.is_active).toBe(0);
		});

		it("returns 403 when member tries to delete", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.shared_org_github);
			await addAccountMember(ctx, USERS.bob.id, ACCOUNTS.shared_org_github.id, "member");
			await seedApiKeyHex(ctx, USERS.bob.id, API_KEYS.bob_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.shared_org_github.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.bob_primary}` },
			});

			expect(res.status).toBe(403);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Forbidden");
			expect(data.message).toBe("Only owners can delete accounts");
		});

		it("returns 404 when account not found", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request("/api/v1/connections/nonexistent-account", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
			expect(data.message).toBe("Account not found");
		});
	});

	describe("POST /api/v1/connections/:account_id/members", () => {
		it("adds member when owner", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}/members`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ user_id: USERS.bob.id }),
			});

			expect(res.status).toBe(201);
			const data = (await res.json()) as AddMemberResponse;
			expect(data.member_id).toBeDefined();
			expect(data.role).toBe("member");

			const membership = await ctx.d1.prepare("SELECT role FROM account_members WHERE user_id = ? AND account_id = ?").bind(USERS.bob.id, ACCOUNTS.alice_github.id).first<{ role: string }>();

			expect(membership?.role).toBe("member");
		});

		it("returns 403 when non-owner tries to add", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedUser(ctx, USERS.charlie);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.shared_org_github);
			await addAccountMember(ctx, USERS.bob.id, ACCOUNTS.shared_org_github.id, "member");
			await seedApiKeyHex(ctx, USERS.bob.id, API_KEYS.bob_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.shared_org_github.id}/members`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.bob_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ user_id: USERS.charlie.id }),
			});

			expect(res.status).toBe(403);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Forbidden");
			expect(data.message).toBe("Only owners can add members");
		});

		it("returns 409 when user already member", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.shared_org_github);
			await addAccountMember(ctx, USERS.bob.id, ACCOUNTS.shared_org_github.id, "member");
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.shared_org_github.id}/members`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ user_id: USERS.bob.id }),
			});

			expect(res.status).toBe(409);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Conflict");
			expect(data.message).toBe("User is already a member");
		});

		it("returns 400 when user_id missing", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);
			const res = await app.request(`/api/v1/connections/${ACCOUNTS.alice_github.id}/members`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Bad request");
			expect(data.message).toBe("user_id required");
		});
	});

	describe("error response format", () => {
		const assertErrorFormat = (data: unknown): data is ErrorResponse => {
			const err = data as ErrorResponse;
			return typeof err.error === "string" && typeof err.message === "string";
		};

		it("all 400 errors have { error, message } format", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);

			const badRequests = [
				app.request("/api/v1/timeline/user-alice/raw/github", {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				}),
				app.request("/api/v1/connections", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${API_KEYS.alice_primary}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ platform: "github" }),
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
			const app = createTestApp(ctx.env);

			const unauthorizedRequests = [
				app.request("/api/v1/timeline/user-alice"),
				app.request("/api/v1/timeline/user-alice", {
					headers: { Authorization: "Bearer invalid-key" },
				}),
				app.request("/api/v1/connections"),
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
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.shared_org_github);
			await addAccountMember(ctx, USERS.bob.id, ACCOUNTS.shared_org_github.id, "member");
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);
			await seedApiKeyHex(ctx, USERS.bob.id, API_KEYS.bob_primary);

			const app = createTestApp(ctx.env);

			const forbiddenRequests = [
				app.request("/api/v1/timeline/user-bob", {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				}),
				app.request(`/api/v1/connections/${ACCOUNTS.shared_org_github.id}`, {
					method: "DELETE",
					headers: { Authorization: `Bearer ${API_KEYS.bob_primary}` },
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
			await seedApiKeyHex(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx.env);

			const notFoundRequests = [
				app.request("/api/v1/timeline/user-alice", {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				}),
				app.request("/api/v1/timeline/user-alice/raw/github?account_id=nonexistent", {
					headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
				}),
				app.request("/api/v1/connections/nonexistent", {
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
