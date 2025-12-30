import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { AppContext } from "../../src/infrastructure";
import { decodeOAuthState, encodeOAuthState, validateOAuthQueryKey, validateOAuthRequest } from "../../src/oauth-helpers";
import { authRoutes } from "../../src/routes";
import { API_KEYS, PROFILES, USERS } from "./fixtures";
import { type TestContext, createTestContext, seedApiKey, seedProfile, seedUser } from "./setup";

type Variables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

type TestBindings = {
	MEDIA_GITHUB_CLIENT_ID: string;
	MEDIA_GITHUB_CLIENT_SECRET: string;
	MEDIA_API_URL: string;
	MEDIA_FRONTEND_URL: string;
};

const createGitHubOAuthTestApp = (ctx: TestContext, envOverrides: Partial<TestBindings> = {}) => {
	const defaultEnv: TestBindings = {
		MEDIA_GITHUB_CLIENT_ID: envOverrides.MEDIA_GITHUB_CLIENT_ID ?? "test-client-id",
		MEDIA_GITHUB_CLIENT_SECRET: envOverrides.MEDIA_GITHUB_CLIENT_SECRET ?? "test-client-secret",
		MEDIA_API_URL: envOverrides.MEDIA_API_URL ?? "http://localhost:8787",
		MEDIA_FRONTEND_URL: envOverrides.MEDIA_FRONTEND_URL ?? "http://localhost:4321",
	};

	const app = new Hono<{ Bindings: TestBindings; Variables: Variables }>();

	const mediaApp = new Hono<{ Bindings: TestBindings; Variables: Variables }>();

	mediaApp.use("/api/*", async (c, next) => {
		c.set("appContext", ctx.appContext);
		await next();
	});

	mediaApp.route("/api/auth", authRoutes);

	app.route("/media", mediaApp);

	return {
		request: async (path: string, init?: RequestInit) => {
			const url = `http://localhost${path}`;
			const request = new Request(url, init);
			return app.fetch(request, defaultEnv);
		},
	};
};

const getLocation = (res: Response): string => {
	const location = res.headers.get("Location");
	if (!location) throw new Error("Expected Location header but found none");
	return location;
};

const parseLocationUrl = (res: Response): URL => new URL(getLocation(res));

const getStateFromResponse = (res: Response): { user_id: string; profile_id: string; nonce: string } => {
	const url = parseLocationUrl(res);
	const state = url.searchParams.get("state");
	if (!state) throw new Error("Expected state parameter but found none");
	return JSON.parse(atob(state));
};

describe("GitHub OAuth Integration", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("GET /media/api/auth/github", () => {
		it("should redirect to GitHub with correct params", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createGitHubOAuthTestApp(ctx);
			const res = await app.request(`/media/api/auth/github?key=${API_KEYS.alice_primary}&profile_id=${PROFILES.alice_main.id}`);

			expect(res.status).toBe(302);

			const location = getLocation(res);
			expect(location).toContain("https://github.com/login/oauth/authorize");

			const url = parseLocationUrl(res);
			expect(url.searchParams.get("client_id")).toBe("test-client-id");
			expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8787/media/api/auth/github/callback");
			expect(url.searchParams.get("scope")).toBe("read:user repo");
			expect(url.searchParams.get("state")).toBeDefined();

			const decodedState = getStateFromResponse(res);
			expect(decodedState.user_id).toBe(USERS.alice.id);
			expect(decodedState.profile_id).toBe(PROFILES.alice_main.id);
			expect(decodedState.nonce).toBeDefined();
		});

		it("should reject without API key", async () => {
			await seedUser(ctx, USERS.alice);

			const app = createGitHubOAuthTestApp(ctx);
			const res = await app.request("/media/api/auth/github");

			expect(res.status).toBe(302);
			const location = getLocation(res);
			expect(location).toContain("http://localhost:4321/connections");
			expect(location).toContain("error=github_no_auth");
		});

		it("should reject with invalid API key", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createGitHubOAuthTestApp(ctx);
			const res = await app.request(`/media/api/auth/github?key=invalid-api-key&profile_id=${PROFILES.alice_main.id}`);

			expect(res.status).toBe(302);
			const location = getLocation(res);
			expect(location).toContain("http://localhost:4321/connections");
			expect(location).toContain("error=github_invalid_auth");
		});

		it("should reject without profile_id", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createGitHubOAuthTestApp(ctx);
			const res = await app.request(`/media/api/auth/github?key=${API_KEYS.alice_primary}`);

			expect(res.status).toBe(302);
			const location = getLocation(res);
			expect(location).toContain("http://localhost:4321/connections");
			expect(location).toContain("error=github_no_profile");
		});

		it("should return 500 when GitHub OAuth not configured", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createGitHubOAuthTestApp(ctx, { MEDIA_GITHUB_CLIENT_ID: "" });
			const res = await app.request(`/media/api/auth/github?key=${API_KEYS.alice_primary}&profile_id=${PROFILES.alice_main.id}`);

			expect(res.status).toBe(500);
			const data = (await res.json()) as { error: string };
			expect(data.error).toBe("GitHub OAuth not configured");
		});
	});

	describe("GET /media/api/auth/github/callback", () => {
		it("should handle missing code", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			const state = btoa(JSON.stringify({ user_id: USERS.alice.id, profile_id: PROFILES.alice_main.id, nonce: "test-nonce" }));

			const app = createGitHubOAuthTestApp(ctx);
			const res = await app.request(`/media/api/auth/github/callback?state=${state}`);

			expect(res.status).toBe(302);
			const location = getLocation(res);
			expect(location).toContain("error=github_no_code");
		});

		it("should handle missing state", async () => {
			const app = createGitHubOAuthTestApp(ctx);
			const res = await app.request("/media/api/auth/github/callback?code=test-code");

			expect(res.status).toBe(302);
			const location = getLocation(res);
			expect(location).toContain("error=github_no_state");
		});

		it("should handle invalid state", async () => {
			const app = createGitHubOAuthTestApp(ctx);
			const res = await app.request("/media/api/auth/github/callback?code=test-code&state=invalid-base64");

			expect(res.status).toBe(302);
			const location = getLocation(res);
			expect(location).toContain("error=github_invalid_state");
		});

		it("should handle state without user_id", async () => {
			const stateWithoutUserId = btoa(JSON.stringify({ profile_id: PROFILES.alice_main.id, nonce: "test-nonce" }));

			const app = createGitHubOAuthTestApp(ctx);
			const res = await app.request(`/media/api/auth/github/callback?code=test-code&state=${stateWithoutUserId}`);

			expect(res.status).toBe(302);
			const location = getLocation(res);
			expect(location).toContain("error=github_invalid_state");
		});

		it("should handle state without profile_id", async () => {
			const stateWithoutProfileId = btoa(JSON.stringify({ user_id: USERS.alice.id, nonce: "test-nonce" }));

			const app = createGitHubOAuthTestApp(ctx);
			const res = await app.request(`/media/api/auth/github/callback?code=test-code&state=${stateWithoutProfileId}`);

			expect(res.status).toBe(302);
			const location = getLocation(res);
			expect(location).toContain("error=github_invalid_state");
		});

		it("should handle OAuth error from GitHub", async () => {
			const state = btoa(JSON.stringify({ user_id: USERS.alice.id, profile_id: PROFILES.alice_main.id, nonce: "test-nonce" }));

			const app = createGitHubOAuthTestApp(ctx);
			const res = await app.request(`/media/api/auth/github/callback?error=access_denied&state=${state}`);

			expect(res.status).toBe(302);
			const location = getLocation(res);
			expect(location).toContain("error=github_auth_denied");
		});

		it("should handle OAuth error_description from GitHub", async () => {
			const state = btoa(JSON.stringify({ user_id: USERS.alice.id, profile_id: PROFILES.alice_main.id, nonce: "test-nonce" }));

			const app = createGitHubOAuthTestApp(ctx);
			const res = await app.request(`/media/api/auth/github/callback?error=access_denied&error_description=User%20denied%20access&state=${state}`);

			expect(res.status).toBe(302);
			const location = getLocation(res);
			expect(location).toContain("error=github_auth_denied");
		});

		it("should handle unconfigured OAuth secrets in callback", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			const state = btoa(JSON.stringify({ user_id: USERS.alice.id, profile_id: PROFILES.alice_main.id, nonce: "test-nonce" }));

			const app = createGitHubOAuthTestApp(ctx, { MEDIA_GITHUB_CLIENT_ID: "", MEDIA_GITHUB_CLIENT_SECRET: "" });
			const res = await app.request(`/media/api/auth/github/callback?code=test-code&state=${state}`);

			expect(res.status).toBe(302);
			const location = getLocation(res);
			expect(location).toContain("error=github_not_configured");
		});
	});

	describe("OAuth state encoding/decoding", () => {
		it("should include user_id, profile_id and nonce in state", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createGitHubOAuthTestApp(ctx);
			const res = await app.request(`/media/api/auth/github?key=${API_KEYS.alice_primary}&profile_id=${PROFILES.alice_main.id}`);

			const decodedState = getStateFromResponse(res);

			expect(decodedState.user_id).toBe(USERS.alice.id);
			expect(decodedState.profile_id).toBe(PROFILES.alice_main.id);
			expect(typeof decodedState.nonce).toBe("string");
			expect(decodedState.nonce.length).toBeGreaterThan(0);
		});

		it("should generate unique nonces for each request", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createGitHubOAuthTestApp(ctx);

			const res1 = await app.request(`/media/api/auth/github?key=${API_KEYS.alice_primary}&profile_id=${PROFILES.alice_main.id}`);
			const res2 = await app.request(`/media/api/auth/github?key=${API_KEYS.alice_primary}&profile_id=${PROFILES.alice_main.id}`);

			const state1 = getStateFromResponse(res1);
			const state2 = getStateFromResponse(res2);

			expect(state1.nonce).not.toBe(state2.nonce);
		});
	});

	describe("OAuth scope configuration", () => {
		it("should request read:user and repo scopes", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createGitHubOAuthTestApp(ctx);
			const res = await app.request(`/media/api/auth/github?key=${API_KEYS.alice_primary}&profile_id=${PROFILES.alice_main.id}`);

			const url = parseLocationUrl(res);
			const scope = url.searchParams.get("scope");

			expect(scope).toBe("read:user repo");
		});
	});

	describe("redirect URI configuration", () => {
		it("should use MEDIA_API_URL for redirect_uri", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createGitHubOAuthTestApp(ctx, { MEDIA_API_URL: "https://api.example.com" });
			const res = await app.request(`/media/api/auth/github?key=${API_KEYS.alice_primary}&profile_id=${PROFILES.alice_main.id}`);

			const url = parseLocationUrl(res);
			const redirectUri = url.searchParams.get("redirect_uri");

			expect(redirectUri).toBe("https://api.example.com/media/api/auth/github/callback");
		});

		it("should use default MEDIA_API_URL when not configured", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createGitHubOAuthTestApp(ctx, { MEDIA_API_URL: "" });
			const res = await app.request(`/media/api/auth/github?key=${API_KEYS.alice_primary}&profile_id=${PROFILES.alice_main.id}`);

			const url = parseLocationUrl(res);
			const redirectUri = url.searchParams.get("redirect_uri");

			expect(redirectUri).toBe("http://localhost:8787/media/api/auth/github/callback");
		});
	});

	describe("frontend redirect configuration", () => {
		it("should redirect errors to MEDIA_FRONTEND_URL", async () => {
			const app = createGitHubOAuthTestApp(ctx, { MEDIA_FRONTEND_URL: "https://app.example.com" });
			const res = await app.request("/media/api/auth/github");

			const location = getLocation(res);
			expect(location).toStartWith("https://app.example.com/connections");
		});

		it("should use default MEDIA_FRONTEND_URL when not configured", async () => {
			const app = createGitHubOAuthTestApp(ctx, { MEDIA_FRONTEND_URL: "" });
			const res = await app.request("/media/api/auth/github");

			const location = getLocation(res);
			expect(location).toStartWith("http://localhost:4321/connections");
		});
	});

	describe("multiple users", () => {
		it("should correctly identify different users via API key", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);
			await seedApiKey(ctx, USERS.bob.id, API_KEYS.bob_primary);

			const app = createGitHubOAuthTestApp(ctx);

			const aliceRes = await app.request(`/media/api/auth/github?key=${API_KEYS.alice_primary}&profile_id=${PROFILES.alice_main.id}`);
			const bobRes = await app.request(`/media/api/auth/github?key=${API_KEYS.bob_primary}&profile_id=${PROFILES.bob_main.id}`);

			const aliceState = getStateFromResponse(aliceRes);
			const bobState = getStateFromResponse(bobRes);

			expect(aliceState.user_id).toBe(USERS.alice.id);
			expect(aliceState.profile_id).toBe(PROFILES.alice_main.id);
			expect(bobState.user_id).toBe(USERS.bob.id);
			expect(bobState.profile_id).toBe(PROFILES.bob_main.id);
		});
	});

	describe("encodeOAuthState helper", () => {
		it("should encode user_id, profile_id and nonce", () => {
			const state = encodeOAuthState("test-user-id", "test-profile-id");
			const decoded = JSON.parse(atob(state));

			expect(decoded.user_id).toBe("test-user-id");
			expect(decoded.profile_id).toBe("test-profile-id");
			expect(typeof decoded.nonce).toBe("string");
			expect(decoded.nonce.length).toBeGreaterThan(0);
		});

		it("should encode extra data when provided", () => {
			const state = encodeOAuthState("test-user-id", "test-profile-id", { custom_field: "custom_value" });
			const decoded = JSON.parse(atob(state));

			expect(decoded.user_id).toBe("test-user-id");
			expect(decoded.profile_id).toBe("test-profile-id");
			expect(decoded.nonce).toBeDefined();
			expect(decoded.custom_field).toBe("custom_value");
		});

		it("should generate unique nonces", () => {
			const state1 = encodeOAuthState("test-user-id", "test-profile-id");
			const state2 = encodeOAuthState("test-user-id", "test-profile-id");

			const decoded1 = JSON.parse(atob(state1));
			const decoded2 = JSON.parse(atob(state2));

			expect(decoded1.nonce).not.toBe(decoded2.nonce);
		});
	});
});
