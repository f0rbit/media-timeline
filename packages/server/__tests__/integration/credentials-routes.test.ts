import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { API_KEYS, PROFILES, USERS } from "./fixtures";
import { type TestContext, createTestApp, createTestContext, seedApiKey, seedProfile, seedUser } from "./setup";

type ErrorResponse = { error: string; message: string; details?: unknown };
type CredentialsExistsResponse = { exists: boolean; isVerified: boolean; clientId: string | null };
type SaveCredentialsResponse = { success: boolean; id: string; message: string; accountId?: string };
type DeleteCredentialsResponse = { success: boolean; message: string };

describe("Credentials Routes", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("GET /api/v1/credentials/:platform", () => {
		it("returns exists: false when no credentials exist", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/credentials/reddit?profile_id=${PROFILES.alice_main.id}`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as CredentialsExistsResponse;
			expect(data.exists).toBe(false);
			expect(data.isVerified).toBe(false);
			expect(data.clientId).toBeNull();
		});

		it("returns exists: true with clientId when credentials exist", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);

			await app.request("/media/api/v1/credentials/twitter", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					profile_id: PROFILES.alice_main.id,
					client_id: "my-twitter-client-id",
					client_secret: "my-twitter-client-secret-long-enough",
				}),
			});

			const res = await app.request(`/media/api/v1/credentials/twitter?profile_id=${PROFILES.alice_main.id}`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as CredentialsExistsResponse;
			expect(data.exists).toBe(true);
			expect(data.isVerified).toBe(false);
			expect(data.clientId).toBe("my-twitter-client-id");
		});

		it("returns 400 when profile_id is missing", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/credentials/reddit", {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Bad request");
			expect(data.message).toContain("profile_id");
		});

		it("returns 404 when profile does not belong to user", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/credentials/reddit?profile_id=${PROFILES.bob_main.id}`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Not found");
		});

		it("returns 400 for invalid platform", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/credentials/invalid-platform?profile_id=${PROFILES.alice_main.id}`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Bad request");
			expect(data.message).toContain("Invalid platform");
		});

		it("returns 401 without authentication", async () => {
			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/credentials/reddit?profile_id=some-profile");

			expect(res.status).toBe(401);
		});
	});

	describe("POST /api/v1/credentials/:platform", () => {
		it("saves credentials for non-Reddit platforms", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/credentials/twitter", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					profile_id: PROFILES.alice_main.id,
					client_id: "twitter-client-12345",
					client_secret: "twitter-secret-very-long-string",
					redirect_uri: "https://myapp.com/callback",
				}),
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as SaveCredentialsResponse;
			expect(data.success).toBe(true);
			expect(data.id).toBeDefined();
			expect(data.message).toContain("Credentials saved");
		});

		it("returns 400 for missing required fields", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/credentials/twitter", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					profile_id: PROFILES.alice_main.id,
					// missing client_id and client_secret
				}),
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.error).toBe("Bad request");
		});

		it("returns 404 when profile does not belong to user", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/credentials/twitter", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					profile_id: PROFILES.bob_main.id,
					client_id: "some-client",
					client_secret: "some-secret-long-enough",
				}),
			});

			expect(res.status).toBe(404);
		});

		it("returns 400 for invalid platform", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/credentials/invalid", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					profile_id: PROFILES.alice_main.id,
					client_id: "some-client",
					client_secret: "some-secret-long-enough",
				}),
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.message).toContain("Invalid platform");
		});

		describe("Reddit-specific validation", () => {
			it("returns 400 when reddit_username is missing for Reddit", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				const app = createTestApp(ctx);
				const res = await app.request("/media/api/v1/credentials/reddit", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${API_KEYS.alice_primary}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						profile_id: PROFILES.alice_main.id,
						client_id: "valid-reddit-client",
						client_secret: "valid-reddit-secret-long-enough",
					}),
				});

				expect(res.status).toBe(400);
				const data = (await res.json()) as ErrorResponse;
				expect(data.error).toBe("Bad request");
				expect(data.message).toContain("Reddit username");
			});

			it("returns 400 for invalid Reddit client_id format", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				const app = createTestApp(ctx);
				const res = await app.request("/media/api/v1/credentials/reddit", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${API_KEYS.alice_primary}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						profile_id: PROFILES.alice_main.id,
						client_id: "bad", // too short
						client_secret: "valid-reddit-secret-long-enough",
						reddit_username: "test_user",
					}),
				});

				expect(res.status).toBe(400);
				const data = (await res.json()) as ErrorResponse;
				expect(data.error).toBe("Bad request");
				expect(data.message).toContain("client_id");
			});

			it("returns 400 for invalid Reddit client_secret format", async () => {
				await seedUser(ctx, USERS.alice);
				await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
				await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

				const app = createTestApp(ctx);
				const res = await app.request("/media/api/v1/credentials/reddit", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${API_KEYS.alice_primary}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						profile_id: PROFILES.alice_main.id,
						client_id: "valid-reddit-client123",
						client_secret: "short", // too short
						reddit_username: "test_user",
					}),
				});

				expect(res.status).toBe(400);
				const data = (await res.json()) as ErrorResponse;
				expect(data.error).toBe("Bad request");
				expect(data.message).toContain("client_secret");
			});
		});
	});

	describe("DELETE /api/v1/credentials/:platform", () => {
		it("deletes existing credentials", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);

			await app.request("/media/api/v1/credentials/twitter", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					profile_id: PROFILES.alice_main.id,
					client_id: "twitter-client-12345",
					client_secret: "twitter-secret-long-enough",
				}),
			});

			const existsBeforeDelete = await app.request(`/media/api/v1/credentials/twitter?profile_id=${PROFILES.alice_main.id}`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});
			const beforeData = (await existsBeforeDelete.json()) as CredentialsExistsResponse;
			expect(beforeData.exists).toBe(true);

			const deleteRes = await app.request(`/media/api/v1/credentials/twitter?profile_id=${PROFILES.alice_main.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(deleteRes.status).toBe(200);
			const deleteData = (await deleteRes.json()) as DeleteCredentialsResponse;
			expect(deleteData.success).toBe(true);
			expect(deleteData.message).toBe("Credentials deleted");

			const existsAfterDelete = await app.request(`/media/api/v1/credentials/twitter?profile_id=${PROFILES.alice_main.id}`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});
			const afterData = (await existsAfterDelete.json()) as CredentialsExistsResponse;
			expect(afterData.exists).toBe(false);
		});

		it("returns success: false when no credentials exist", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/credentials/twitter?profile_id=${PROFILES.alice_main.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(200);
			const data = (await res.json()) as DeleteCredentialsResponse;
			expect(data.success).toBe(false);
			expect(data.message).toBe("No credentials found");
		});

		it("returns 400 when profile_id is missing", async () => {
			await seedUser(ctx, USERS.alice);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request("/media/api/v1/credentials/twitter", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.message).toContain("profile_id");
		});

		it("returns 404 when profile does not belong to user", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/credentials/twitter?profile_id=${PROFILES.bob_main.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(404);
		});

		it("returns 400 for invalid platform", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);
			const res = await app.request(`/media/api/v1/credentials/invalid?profile_id=${PROFILES.alice_main.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			expect(res.status).toBe(400);
			const data = (await res.json()) as ErrorResponse;
			expect(data.message).toContain("Invalid platform");
		});

		it("only deletes credentials for specified platform", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedApiKey(ctx, USERS.alice.id, API_KEYS.alice_primary);

			const app = createTestApp(ctx);

			await app.request("/media/api/v1/credentials/twitter", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					profile_id: PROFILES.alice_main.id,
					client_id: "twitter-client-id",
					client_secret: "twitter-secret-long-enough",
				}),
			});

			await app.request("/media/api/v1/credentials/github", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${API_KEYS.alice_primary}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					profile_id: PROFILES.alice_main.id,
					client_id: "github-client-id",
					client_secret: "github-secret-long-enough",
				}),
			});

			await app.request(`/media/api/v1/credentials/twitter?profile_id=${PROFILES.alice_main.id}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});

			const twitterRes = await app.request(`/media/api/v1/credentials/twitter?profile_id=${PROFILES.alice_main.id}`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});
			const twitterData = (await twitterRes.json()) as CredentialsExistsResponse;
			expect(twitterData.exists).toBe(false);

			const githubRes = await app.request(`/media/api/v1/credentials/github?profile_id=${PROFILES.alice_main.id}`, {
				headers: { Authorization: `Bearer ${API_KEYS.alice_primary}` },
			});
			const githubData = (await githubRes.json()) as CredentialsExistsResponse;
			expect(githubData.exists).toBe(true);
		});
	});
});
