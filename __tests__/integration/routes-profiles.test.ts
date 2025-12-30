import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ACCOUNTS, API_KEYS, PROFILES, USERS } from "./fixtures";
import { type ProfileFilterSeed, type TestContext, createTestApp, createTestContext, seedAccount, seedApiKey, seedProfile, seedProfileFilter, seedUser } from "./setup";

type ErrorResponse = { error: string; message: string; details?: unknown };
type ProfileResponse = {
	profile: {
		id: string;
		slug: string;
		name: string;
		description: string | null;
		theme: string | null;
		created_at: string;
		updated_at: string;
		filters: Array<{
			id: string;
			account_id: string;
			filter_type: "include" | "exclude";
			filter_key: string;
			filter_value: string;
		}>;
	};
};

type ProfileListResponse = {
	profiles: Array<{
		id: string;
		slug: string;
		name: string;
		description: string | null;
		theme: string | null;
		created_at: string;
		updated_at: string;
	}>;
};

type FilterResponse = {
	id: string;
	account_id: string;
	platform: string | null;
	filter_type: string;
	filter_key: string;
	filter_value: string;
	created_at: string;
};

type FiltersListResponse = {
	filters: Array<{
		id: string;
		account_id: string;
		platform: string;
		filter_type: string;
		filter_key: string;
		filter_value: string;
		created_at: string;
	}>;
};

type DeleteResponse = { deleted: boolean; id: string };

describe("Profile Routes", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("GET /api/v1/profiles", () => {
		it("returns all profiles for authenticated user", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_work);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/profiles", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as ProfileListResponse;
			expect(data.profiles).toHaveLength(2);
			expect(data.profiles.map(p => p.slug).sort()).toEqual(["main", "work"]);
		});

		it("returns empty array for user with no profiles", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/profiles", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as ProfileListResponse;
			expect(data.profiles).toHaveLength(0);
		});

		it("only returns profiles owned by the authenticated user", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/profiles", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as ProfileListResponse;
			expect(data.profiles).toHaveLength(1);
			expect(data.profiles[0]?.id).toBe(PROFILES.alice_main.id);
		});

		it("returns 401 without authentication", async () => {
			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/profiles");

			expect(res.status).toBe(401);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Unauthorized");
		});
	});

	describe("POST /api/v1/profiles", () => {
		it("creates a new profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/profiles", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					slug: "new-profile",
					name: "My New Profile",
					description: "A test profile",
					theme: "dark",
				}),
			});

			expect(res.status).toBe(201);
			const data = (await res.json()) as ProfileResponse;
			expect(data.profile.slug).toBe("new-profile");
			expect(data.profile.name).toBe("My New Profile");
			expect(data.profile.description).toBe("A test profile");
			expect(data.profile.theme).toBe("dark");
			expect(data.profile.filters).toHaveLength(0);
		});

		it("creates profile with minimal fields", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/profiles", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					slug: "minimal",
					name: "Minimal Profile",
				}),
			});

			expect(res.status).toBe(201);
			const data = (await res.json()) as ProfileResponse;
			expect(data.profile.slug).toBe("minimal");
			expect(data.profile.name).toBe("Minimal Profile");
			expect(data.profile.description).toBeNull();
			expect(data.profile.theme).toBeNull();
		});

		it("returns 409 for duplicate slug", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/profiles", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					slug: PROFILES.alice_main.slug,
					name: "Duplicate Slug Profile",
				}),
			});

			expect(res.status).toBe(409);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Conflict");
			expect(data.message).toContain("slug already exists");
		});

		it("allows same slug for different users", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.bob.id, API_KEYS.bob_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/profiles", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.bob_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					slug: PROFILES.alice_main.slug,
					name: "Bob's Main",
				}),
			});

			expect(res.status).toBe(201);
		});

		it("returns 400 for invalid slug format", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);

			const invalidSlugs = ["AB", "Invalid_Slug", "-invalid", "invalid-", "has spaces"];

			for (const slug of invalidSlugs) {
				const res = await app.request("/media/api/v1/profiles", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${API_KEYS.alice_primary}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						slug,
						name: "Test Profile",
					}),
				});

				expect(res.status).toBe(400);
			}
		});

		it("returns 400 for missing required fields", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);

			const res = await app.request("/media/api/v1/profiles", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					slug: "valid-slug",
				}),
			});

			expect(res.status).toBe(400);
		});
	});

	describe("GET /api/v1/profiles/:id", () => {
		it("returns profile by id with filters", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedProfileFilter(ctx, PROFILES.alice_main.id, {
				account_id: ACCOUNTS.alice_github.id,
				filter_type: "include",
				filter_key: "repo",
				filter_value: "alice/project",
			});
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as ProfileResponse;
			expect(data.profile.id).toBe(PROFILES.alice_main.id);
			expect(data.profile.slug).toBe(PROFILES.alice_main.slug);
			expect(data.profile.filters).toHaveLength(1);
			expect(data.profile.filters[0]?.filter_value).toBe("alice/project");
		});

		it("returns 404 for non-existent profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/profiles/nonexistent-id", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
		});

		it("returns 403 when accessing another users profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.bob_main.id}`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(403);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Forbidden");
		});
	});

	describe("PATCH /api/v1/profiles/:id", () => {
		it("updates profile name", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}`, {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					name: "Updated Name",
				}),
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as ProfileResponse;
			expect(data.profile.name).toBe("Updated Name");
		});

		it("updates profile slug", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}`, {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					slug: "new-slug",
				}),
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as ProfileResponse;
			expect(data.profile.slug).toBe("new-slug");
		});

		it("returns 409 when updating to duplicate slug", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_work);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}`, {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					slug: PROFILES.alice_work.slug,
				}),
			});

			expect(res.status).toBe(409);
		});

		it("allows updating to same slug (no-op)", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}`, {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					slug: PROFILES.alice_main.slug,
				}),
			});

			expect(res.status).toBe(200);
		});

		it("returns 400 when no fields to update", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}`, {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.message).toContain("No fields to update");
		});

		it("returns 403 when updating another users profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.bob_main.id}`, {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ name: "Hacked!" }),
			});

			expect(res.status).toBe(403);
		});

		it("can update description to null", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, {
				...PROFILES.alice_main,
				description: "Has description",
			});
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}`, {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ description: null }),
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as ProfileResponse;
			expect(data.profile.description).toBeNull();
		});
	});

	describe("DELETE /api/v1/profiles/:id", () => {
		it("deletes a profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as DeleteResponse;
			expect(data.deleted).toBe(true);
			expect(data.id).toBe(PROFILES.alice_main.id);

			const profile = await ctx.d1.prepare("SELECT * FROM media_profiles WHERE id = ?").bind(PROFILES.alice_main.id).first();
			expect(profile).toBeNull();
		});

		it("deletes profile with associated accounts", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);

			const profile = await ctx.d1.prepare("SELECT * FROM media_profiles WHERE id = ?").bind(PROFILES.alice_main.id).first();
			expect(profile).toBeNull();
		});

		it("returns 403 when deleting another users profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.bob_main.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(403);
		});

		it("returns 404 for non-existent profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/profiles/nonexistent-id", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
		});
	});

	describe("GET /api/v1/profiles/:id/filters", () => {
		it("returns filters for a profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_reddit);
			await seedProfileFilter(ctx, PROFILES.alice_main.id, {
				account_id: ACCOUNTS.alice_github.id,
				filter_type: "include",
				filter_key: "repo",
				filter_value: "alice/project",
			});
			await seedProfileFilter(ctx, PROFILES.alice_main.id, {
				account_id: ACCOUNTS.alice_reddit.id,
				filter_type: "exclude",
				filter_key: "subreddit",
				filter_value: "nsfw",
			});
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}/filters`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as FiltersListResponse;
			expect(data.filters).toHaveLength(2);
			expect(data.filters.some(f => f.platform === "github")).toBe(true);
			expect(data.filters.some(f => f.platform === "reddit")).toBe(true);
		});

		it("returns empty array for profile with no filters", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}/filters`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as FiltersListResponse;
			expect(data.filters).toHaveLength(0);
		});

		it("returns 403 for another users profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.bob_main.id}/filters`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(403);
		});
	});

	describe("POST /api/v1/profiles/:id/filters", () => {
		it("creates a new filter", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}/filters`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					account_id: ACCOUNTS.alice_github.id,
					filter_type: "include",
					filter_key: "repo",
					filter_value: "alice/my-project",
				}),
			});

			expect(res.status).toBe(201);
			const data = (await res.json()) as FilterResponse;
			expect(data.account_id).toBe(ACCOUNTS.alice_github.id);
			expect(data.platform).toBe("github");
			expect(data.filter_type).toBe("include");
			expect(data.filter_key).toBe("repo");
			expect(data.filter_value).toBe("alice/my-project");
		});

		it("creates exclude filter", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_reddit);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}/filters`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					account_id: ACCOUNTS.alice_reddit.id,
					filter_type: "exclude",
					filter_key: "subreddit",
					filter_value: "nsfw",
				}),
			});

			expect(res.status).toBe(201);
			const data = (await res.json()) as FilterResponse;
			expect(data.filter_type).toBe("exclude");
		});

		it("returns 400 for invalid filter_type", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}/filters`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					account_id: ACCOUNTS.alice_github.id,
					filter_type: "invalid",
					filter_key: "repo",
					filter_value: "alice/project",
				}),
			});

			expect(res.status).toBe(400);
		});

		it("returns 400 for invalid filter_key", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}/filters`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					account_id: ACCOUNTS.alice_github.id,
					filter_type: "include",
					filter_key: "invalid_key",
					filter_value: "some-value",
				}),
			});

			expect(res.status).toBe(400);
		});

		it("returns 404 when account does not exist", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}/filters`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					account_id: "nonexistent-account",
					filter_type: "include",
					filter_key: "repo",
					filter_value: "alice/project",
				}),
			});

			expect(res.status).toBe(404);
		});

		it("returns 403 when account belongs to another user", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedAccount(ctx, PROFILES.bob_main.id, ACCOUNTS.bob_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}/filters`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					account_id: ACCOUNTS.bob_github.id,
					filter_type: "include",
					filter_key: "repo",
					filter_value: "bob/project",
				}),
			});

			expect(res.status).toBe(403);
		});

		it("returns 400 for empty filter_value", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}/filters`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					account_id: ACCOUNTS.alice_github.id,
					filter_type: "include",
					filter_key: "repo",
					filter_value: "",
				}),
			});

			expect(res.status).toBe(400);
		});
	});

	describe("DELETE /api/v1/profiles/:id/filters/:filter_id", () => {
		it("deletes a filter", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			const filterId = await seedProfileFilter(ctx, PROFILES.alice_main.id, {
				account_id: ACCOUNTS.alice_github.id,
				filter_type: "include",
				filter_key: "repo",
				filter_value: "alice/project",
			});
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}/filters/${filterId}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(204);

			const filter = await ctx.d1.prepare("SELECT * FROM media_profile_filters WHERE id = ?").bind(filterId).first();
			expect(filter).toBeNull();
		});

		it("returns 404 for non-existent filter", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.id}/filters/nonexistent-filter`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
		});

		it("returns 403 when deleting filter from another users profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedAccount(ctx, PROFILES.bob_main.id, ACCOUNTS.bob_github);
			const filterId = await seedProfileFilter(ctx, PROFILES.bob_main.id, {
				account_id: ACCOUNTS.bob_github.id,
				filter_type: "include",
				filter_key: "repo",
				filter_value: "bob/project",
			});
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.bob_main.id}/filters/${filterId}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(403);
		});

		it("returns 404 when filter belongs to different profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_work);
			await seedAccount(ctx, PROFILES.alice_main.id, ACCOUNTS.alice_github);
			const filterId = await seedProfileFilter(ctx, PROFILES.alice_main.id, {
				account_id: ACCOUNTS.alice_github.id,
				filter_type: "include",
				filter_key: "repo",
				filter_value: "alice/project",
			});
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_work.id}/filters/${filterId}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
		});
	});

	describe("GET /api/v1/profiles/:slug/timeline", () => {
		it("returns 404 for non-existent profile slug", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/profiles/nonexistent/timeline", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
		});

		it("returns 404 when accessing another users profile timeline by slug", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.bob_main.slug}/timeline`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
		});

		it("validates limit query parameter", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.slug}/timeline?limit=1000`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(400);
		});

		it("validates before query parameter format", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/profiles/${PROFILES.alice_main.slug}/timeline?before=invalid-date`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(400);
		});
	});
});
