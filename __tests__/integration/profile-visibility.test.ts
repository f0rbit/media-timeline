import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ACCOUNTS, API_KEYS, PROFILES, USERS } from "./fixtures";
import { type ProfileSeed, type TestContext, createTestApp, createTestContext, seedAccount, seedApiKey, seedProfile, seedProfileVisibility, seedUser } from "./setup";

type VisibilityResponse = {
	visibility: Array<{
		account_id: string;
		platform: string;
		platform_username: string | null;
		is_visible: boolean;
	}>;
};

type UpdateVisibilityResponse = {
	updated: boolean;
	count: number;
};

type ErrorResponse = { error: string; message: string };

describe("Profile visibility routes", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("GET /api/v1/profiles/:id/visibility", () => {
		it("returns visibility for all user accounts with defaults", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_bluesky);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/profiles/${PROFILES.alice_main.id}/visibility`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as VisibilityResponse;
			expect(data.visibility).toHaveLength(2);

			const githubVisibility = data.visibility.find(v => v.account_id === ACCOUNTS.alice_github.id);
			expect(githubVisibility).toBeDefined();
			expect(githubVisibility?.platform).toBe("github");
			expect(githubVisibility?.is_visible).toBe(true);

			const blueskyVisibility = data.visibility.find(v => v.account_id === ACCOUNTS.alice_bluesky.id);
			expect(blueskyVisibility).toBeDefined();
			expect(blueskyVisibility?.platform).toBe("bluesky");
			expect(blueskyVisibility?.is_visible).toBe(true);
		});

		it("returns visibility with custom settings from database", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_bluesky);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfileVisibility(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github.id, false);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/profiles/${PROFILES.alice_main.id}/visibility`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as VisibilityResponse;

			const githubVisibility = data.visibility.find(v => v.account_id === ACCOUNTS.alice_github.id);
			expect(githubVisibility?.is_visible).toBe(false);

			const blueskyVisibility = data.visibility.find(v => v.account_id === ACCOUNTS.alice_bluesky.id);
			expect(blueskyVisibility?.is_visible).toBe(true);
		});

		it("returns 404 when profile not found", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/api/v1/profiles/nonexistent-profile/visibility", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
			expect(data.message).toBe("Profile not found");
		});

		it("returns 403 when accessing another user's profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/profiles/${PROFILES.bob_main.id}/visibility`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(403);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Forbidden");
			expect(data.message).toBe("You do not own this profile");
		});

		it("returns empty array for user with no accounts", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/profiles/${PROFILES.alice_main.id}/visibility`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as VisibilityResponse;
			expect(data.visibility).toHaveLength(0);
		});
	});

	describe("PUT /api/v1/profiles/:id/visibility", () => {
		it("updates visibility for owned accounts", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_bluesky);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/profiles/${PROFILES.alice_main.id}/visibility`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					visibility: [
						{ account_id: ACCOUNTS.alice_github.id, is_visible: false },
						{ account_id: ACCOUNTS.alice_bluesky.id, is_visible: true },
					],
				}),
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as UpdateVisibilityResponse;
			expect(data.updated).toBe(true);
			expect(data.count).toBe(2);

			const getRes = await app.request(`/api/v1/profiles/${PROFILES.alice_main.id}/visibility`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			const getData = (await getRes.json()) as VisibilityResponse;
			const githubVisibility = getData.visibility.find(v => v.account_id === ACCOUNTS.alice_github.id);
			expect(githubVisibility?.is_visible).toBe(false);
		});

		it("upserts existing visibility records", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfileVisibility(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github.id, false);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/profiles/${PROFILES.alice_main.id}/visibility`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					visibility: [{ account_id: ACCOUNTS.alice_github.id, is_visible: true }],
				}),
			});

			expect(res.status).toBe(200);

			const getRes = await app.request(`/api/v1/profiles/${PROFILES.alice_main.id}/visibility`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			const getData = (await getRes.json()) as VisibilityResponse;
			const githubVisibility = getData.visibility.find(v => v.account_id === ACCOUNTS.alice_github.id);
			expect(githubVisibility?.is_visible).toBe(true);
		});

		it("returns 403 when trying to set visibility for unowned account", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, USERS.bob.id, ACCOUNTS.bob_github);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/profiles/${PROFILES.alice_main.id}/visibility`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					visibility: [{ account_id: ACCOUNTS.bob_github.id, is_visible: false }],
				}),
			});

			expect(res.status).toBe(403);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Forbidden");
			expect(data.message).toContain("Cannot set visibility for accounts you don't own");
		});

		it("returns 404 when profile not found", async () => {
			await seedUser(ctx, USERS.alice);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/api/v1/profiles/nonexistent-profile/visibility", {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					visibility: [{ account_id: ACCOUNTS.alice_github.id, is_visible: false }],
				}),
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
		});

		it("returns 403 when updating another user's profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedAccount(ctx, USERS.alice.id, ACCOUNTS.alice_github);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/profiles/${PROFILES.bob_main.id}/visibility`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					visibility: [{ account_id: ACCOUNTS.alice_github.id, is_visible: false }],
				}),
			});

			expect(res.status).toBe(403);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Forbidden");
		});

		it("returns 400 for invalid request body", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/profiles/${PROFILES.alice_main.id}/visibility`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					visibility: [{ account_id: "acc-123" }],
				}),
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Bad request");
		});

		it("handles empty visibility array", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/api/v1/profiles/${PROFILES.alice_main.id}/visibility`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					visibility: [],
				}),
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as UpdateVisibilityResponse;
			expect(data.updated).toBe(true);
			expect(data.count).toBe(0);
		});
	});
});
