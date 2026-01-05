import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as devpadAuth from "@media/server/auth";
import { type AuthContext, authMiddleware, getAuth } from "@media/server/auth";
import type { AppContext } from "@media/server/infrastructure/context";
import { Hono } from "hono";
import { USERS } from "./fixtures";
import { type TestContext, createTestContext, seedUser } from "./setup";

type TestVariables = {
	auth: AuthContext;
	appContext: AppContext;
};

type AuthResponse = { id: string; name: string | null; email: string | null; image_url: string | null };
type ErrorResponse = { error: string; message?: string };

const createAuthTestApp = (ctx: TestContext) => {
	const app = new Hono<{ Variables: TestVariables }>();

	app.use("/media/api/*", async (c, next) => {
		c.set("appContext", ctx.appContext);
		await next();
	});

	app.use("/media/api/*", authMiddleware);

	app.get("/media/api/me", c => {
		const auth = getAuth(c);
		return c.json({
			id: auth.user_id,
			name: auth.name,
			email: auth.email,
			image_url: auth.image_url,
		});
	});

	return app;
};

describe("authMiddleware", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	describe("session cookie authentication", () => {
		it("authenticates with valid session cookie and syncs new user", async () => {
			const mockDevpadUser = {
				id: "devpad-user-123",
				name: "Test User",
				email: "test@example.com",
				github_id: 12345,
				image_url: "https://example.com/avatar.jpg",
			};

			const verifySpy = spyOn(devpadAuth, "verifySessionCookie").mockResolvedValue({
				authenticated: true,
				user: mockDevpadUser,
			});

			const app = createAuthTestApp(ctx);
			const res = await app.request("/media/api/me", {
				headers: { Cookie: "auth_session=valid-session-token" },
			});

			expect(res.status).toBe(200);
			const body = (await res.json()) as AuthResponse;
			expect(body.id).toBe("devpad-user-123");

			verifySpy.mockRestore();
		});

		it("authenticates with valid session cookie and updates existing user", async () => {
			const devpadUserId = "devpad-existing-user";
			await seedUser(ctx, { ...USERS.alice, id: devpadUserId });

			const mockDevpadUser = {
				id: devpadUserId,
				name: "Updated Name",
				email: "updated@example.com",
				github_id: 12345,
				image_url: null,
			};

			const verifySpy = spyOn(devpadAuth, "verifySessionCookie").mockResolvedValue({
				authenticated: true,
				user: mockDevpadUser,
			});

			const app = createAuthTestApp(ctx);
			const res = await app.request("/media/api/me", {
				headers: { Cookie: "auth_session=valid-session-token" },
			});

			expect(res.status).toBe(200);
			const body = (await res.json()) as AuthResponse;
			expect(body.id).toBe(devpadUserId);

			verifySpy.mockRestore();
		});

		it("returns 401 with invalid session cookie", async () => {
			const verifySpy = spyOn(devpadAuth, "verifySessionCookie").mockResolvedValue({
				authenticated: false,
			});

			const app = createAuthTestApp(ctx);
			const res = await app.request("/media/api/me", {
				headers: { Cookie: "auth_session=invalid-session" },
			});

			expect(res.status).toBe(401);
			const body = (await res.json()) as ErrorResponse;
			expect(body.error).toBe("Unauthorized");

			verifySpy.mockRestore();
		});
	});

	describe("API key authentication", () => {
		it("authenticates with valid API key", async () => {
			const mockDevpadUser = {
				id: "devpad-api-user",
				name: "API User",
				email: "api@example.com",
				github_id: null,
				image_url: null,
			};

			const verifySpy = spyOn(devpadAuth, "verifyApiKey").mockResolvedValue({
				authenticated: true,
				user: mockDevpadUser,
			});

			const app = createAuthTestApp(ctx);
			const res = await app.request("/media/api/me", {
				headers: { Authorization: "Bearer valid-api-key" },
			});

			expect(res.status).toBe(200);
			const body = (await res.json()) as AuthResponse;
			expect(body.id).toBe("devpad-api-user");

			verifySpy.mockRestore();
		});

		it("returns 401 with invalid API key", async () => {
			const verifySpy = spyOn(devpadAuth, "verifyApiKey").mockResolvedValue({
				authenticated: false,
			});

			const app = createAuthTestApp(ctx);
			const res = await app.request("/media/api/me", {
				headers: { Authorization: "Bearer invalid-api-key" },
			});

			expect(res.status).toBe(401);
			const body = (await res.json()) as ErrorResponse;
			expect(body.error).toBe("Unauthorized");

			verifySpy.mockRestore();
		});
	});

	describe("authentication priority", () => {
		it("tries session cookie before API key", async () => {
			const mockDevpadUser = {
				id: "cookie-user",
				name: "Cookie User",
				email: "cookie@example.com",
				github_id: null,
				image_url: null,
			};

			const cookieSpy = spyOn(devpadAuth, "verifySessionCookie").mockResolvedValue({
				authenticated: true,
				user: mockDevpadUser,
			});

			const apiKeySpy = spyOn(devpadAuth, "verifyApiKey").mockResolvedValue({
				authenticated: true,
				user: { ...mockDevpadUser, id: "api-key-user" },
			});

			const app = createAuthTestApp(ctx);
			const res = await app.request("/media/api/me", {
				headers: {
					Cookie: "auth_session=valid-session",
					Authorization: "Bearer valid-api-key",
				},
			});

			expect(res.status).toBe(200);
			const body = (await res.json()) as AuthResponse;
			expect(body.id).toBe("cookie-user");
			expect(apiKeySpy).not.toHaveBeenCalled();

			cookieSpy.mockRestore();
			apiKeySpy.mockRestore();
		});

		it("falls back to API key when cookie is invalid", async () => {
			const mockDevpadUser = {
				id: "api-key-user",
				name: "API User",
				email: "api@example.com",
				github_id: null,
				image_url: null,
			};

			const cookieSpy = spyOn(devpadAuth, "verifySessionCookie").mockResolvedValue({
				authenticated: false,
			});

			const apiKeySpy = spyOn(devpadAuth, "verifyApiKey").mockResolvedValue({
				authenticated: true,
				user: mockDevpadUser,
			});

			const app = createAuthTestApp(ctx);
			const res = await app.request("/media/api/me", {
				headers: {
					Cookie: "auth_session=invalid-session",
					Authorization: "Bearer valid-api-key",
				},
			});

			expect(res.status).toBe(200);
			const body = (await res.json()) as AuthResponse;
			expect(body.id).toBe("api-key-user");

			cookieSpy.mockRestore();
			apiKeySpy.mockRestore();
		});
	});

	describe("no authentication", () => {
		it("returns 401 when no credentials provided", async () => {
			const app = createAuthTestApp(ctx);
			const res = await app.request("/media/api/me");

			expect(res.status).toBe(401);
			const body = (await res.json()) as ErrorResponse;
			expect(body.error).toBe("Unauthorized");
			expect(body.message).toBe("Authentication required");
		});
	});

	describe("getAuth helper", () => {
		it("returns 500 when middleware not applied and getAuth is called", async () => {
			const app = new Hono();
			app.get("/media/api/test", c => {
				getAuth(c);
				return c.json({ ok: true });
			});

			const res = await app.request("/media/api/test");
			expect(res.status).toBe(500);
		});
	});
});

// syncDevpadUser tests removed - function no longer exists
// User IDs are now DevPad IDs directly, no sync needed

describe("verifySessionCookie", () => {
	it("returns authenticated false on non-200 response", async () => {
		const result = await devpadAuth.verifySessionCookie("invalid-cookie", {
			baseUrl: "http://localhost:9999",
		});
		expect(result.authenticated).toBe(false);
	});
});

describe("verifyApiKey", () => {
	it("returns authenticated false on non-200 response", async () => {
		const result = await devpadAuth.verifyApiKey("invalid-api-key", {
			baseUrl: "http://localhost:9999",
		});
		expect(result.authenticated).toBe(false);
	});
});
