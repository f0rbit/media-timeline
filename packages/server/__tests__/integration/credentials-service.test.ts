import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { platformCredentials } from "@media/schema/database";
import { deleteCredentials, getCredentials, hasCredentials, markCredentialsVerified, saveCredentials } from "@media/server/services/credentials";
import { and, count, eq } from "drizzle-orm";
import { PROFILES, USERS } from "./fixtures";
import { type TestContext, createTestContext, seedProfile, seedUser } from "./setup";

describe("Credentials Service", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestContext();
	});

	afterEach(() => {
		ctx.cleanup();
	});

	describe("saveCredentials", () => {
		it("encrypts and stores new credentials", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			const result = await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "test-client-id-12345",
				clientSecret: "test-secret-very-long-string",
				redirectUri: "https://example.com/callback",
			});

			expect(result.id).toBeDefined();
			expect(typeof result.id).toBe("string");

			const stored = await ctx.drizzle.select().from(platformCredentials).where(eq(platformCredentials.id, result.id)).get();

			expect(stored).not.toBeNull();
			expect(stored?.profile_id).toBe(PROFILES.alice_main.id);
			expect(stored?.platform).toBe("reddit");
			expect(stored?.client_id).toBe("test-client-id-12345");
			expect(stored?.client_secret_encrypted).not.toBe("test-secret-very-long-string");
			expect(stored?.redirect_uri).toBe("https://example.com/callback");
			expect(stored?.is_verified).toBe(false);
		});

		it("updates existing credentials for same profile and platform", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			const firstResult = await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "original-client-id",
				clientSecret: "original-secret-string",
			});

			const secondResult = await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "updated-client-id",
				clientSecret: "updated-secret-string",
			});

			expect(secondResult.id).toBe(firstResult.id);

			const countResult = await ctx.drizzle
				.select({ count: count() })
				.from(platformCredentials)
				.where(and(eq(platformCredentials.profile_id, PROFILES.alice_main.id), eq(platformCredentials.platform, "reddit")))
				.get();

			expect(countResult?.count).toBe(1);

			const credentials = await getCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			expect(credentials?.clientId).toBe("updated-client-id");
			expect(credentials?.clientSecret).toBe("updated-secret-string");
		});

		it("stores credentials with metadata", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "twitter",
				clientId: "twitter-client-id",
				clientSecret: "twitter-secret-string",
				metadata: { app_name: "My App", created_by: "alice" },
			});

			const credentials = await getCredentials(ctx.appContext, PROFILES.alice_main.id, "twitter");
			expect(credentials?.metadata).toEqual({ app_name: "My App", created_by: "alice" });
		});

		it("allows same platform credentials for different profiles", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);

			const aliceResult = await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "alice-client-id",
				clientSecret: "alice-secret-string",
			});

			const bobResult = await saveCredentials(ctx.appContext, {
				profileId: PROFILES.bob_main.id,
				platform: "reddit",
				clientId: "bob-client-id",
				clientSecret: "bob-secret-string",
			});

			expect(aliceResult.id).not.toBe(bobResult.id);

			const aliceCreds = await getCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			const bobCreds = await getCredentials(ctx.appContext, PROFILES.bob_main.id, "reddit");

			expect(aliceCreds?.clientId).toBe("alice-client-id");
			expect(bobCreds?.clientId).toBe("bob-client-id");
		});
	});

	describe("getCredentials", () => {
		it("returns null when no credentials exist", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			const credentials = await getCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			expect(credentials).toBeNull();
		});

		it("decrypts and returns existing credentials", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "test-client-id-abc",
				clientSecret: "super-secret-password-123",
				redirectUri: "https://myapp.com/oauth/callback",
			});

			const credentials = await getCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");

			expect(credentials).not.toBeNull();
			expect(credentials?.profileId).toBe(PROFILES.alice_main.id);
			expect(credentials?.platform).toBe("reddit");
			expect(credentials?.clientId).toBe("test-client-id-abc");
			expect(credentials?.clientSecret).toBe("super-secret-password-123");
			expect(credentials?.redirectUri).toBe("https://myapp.com/oauth/callback");
			expect(credentials?.isVerified).toBe(false);
		});

		it("returns null for non-existent platform", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "test-client",
				clientSecret: "test-secret-string",
			});

			const twitterCreds = await getCredentials(ctx.appContext, PROFILES.alice_main.id, "twitter");
			expect(twitterCreds).toBeNull();
		});

		it("returns null for non-existent profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "test-client",
				clientSecret: "test-secret-string",
			});

			const credentials = await getCredentials(ctx.appContext, "nonexistent-profile-id", "reddit");
			expect(credentials).toBeNull();
		});
	});

	describe("deleteCredentials", () => {
		it("removes credentials and returns true", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "test-client",
				clientSecret: "test-secret-string",
			});

			const hasCredsBeforeDelete = await hasCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			expect(hasCredsBeforeDelete).toBe(true);

			const deleted = await deleteCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			expect(deleted).toBe(true);

			const hasCredsAfterDelete = await hasCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			expect(hasCredsAfterDelete).toBe(false);
		});

		it("returns false when no credentials exist", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			const deleted = await deleteCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			expect(deleted).toBe(false);
		});

		it("only deletes credentials for specified platform", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "reddit-client",
				clientSecret: "reddit-secret-string",
			});

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "twitter",
				clientId: "twitter-client",
				clientSecret: "twitter-secret-string",
			});

			const deleted = await deleteCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			expect(deleted).toBe(true);

			const redditCreds = await hasCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			const twitterCreds = await hasCredentials(ctx.appContext, PROFILES.alice_main.id, "twitter");

			expect(redditCreds).toBe(false);
			expect(twitterCreds).toBe(true);
		});
	});

	describe("hasCredentials", () => {
		it("returns true when credentials exist", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "test-client",
				clientSecret: "test-secret-string",
			});

			const hasCreds = await hasCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			expect(hasCreds).toBe(true);
		});

		it("returns false when no credentials exist", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			const hasCreds = await hasCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			expect(hasCreds).toBe(false);
		});

		it("returns false for different platform", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "test-client",
				clientSecret: "test-secret-string",
			});

			const hasCreds = await hasCredentials(ctx.appContext, PROFILES.alice_main.id, "twitter");
			expect(hasCreds).toBe(false);
		});

		it("returns false for different profile", async () => {
			await seedUser(ctx, USERS.alice);
			await seedUser(ctx, USERS.bob);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);
			await seedProfile(ctx, USERS.bob.id, PROFILES.bob_main);

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "test-client",
				clientSecret: "test-secret-string",
			});

			const hasCreds = await hasCredentials(ctx.appContext, PROFILES.bob_main.id, "reddit");
			expect(hasCreds).toBe(false);
		});
	});

	describe("markCredentialsVerified", () => {
		it("updates is_verified flag to true", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "test-client",
				clientSecret: "test-secret-string",
			});

			const beforeVerify = await getCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			expect(beforeVerify?.isVerified).toBe(false);

			await markCredentialsVerified(ctx.appContext, PROFILES.alice_main.id, "reddit");

			const afterVerify = await getCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			expect(afterVerify?.isVerified).toBe(true);
		});

		it("does not affect other platforms", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "reddit-client",
				clientSecret: "reddit-secret-string",
			});

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "twitter",
				clientId: "twitter-client",
				clientSecret: "twitter-secret-string",
			});

			await markCredentialsVerified(ctx.appContext, PROFILES.alice_main.id, "reddit");

			const redditCreds = await getCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			const twitterCreds = await getCredentials(ctx.appContext, PROFILES.alice_main.id, "twitter");

			expect(redditCreds?.isVerified).toBe(true);
			expect(twitterCreds?.isVerified).toBe(false);
		});

		it("handles non-existent credentials gracefully", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			await markCredentialsVerified(ctx.appContext, PROFILES.alice_main.id, "reddit");

			const hasCreds = await hasCredentials(ctx.appContext, PROFILES.alice_main.id, "reddit");
			expect(hasCreds).toBe(false);
		});

		it("updates the updated_at timestamp", async () => {
			await seedUser(ctx, USERS.alice);
			await seedProfile(ctx, USERS.alice.id, PROFILES.alice_main);

			await saveCredentials(ctx.appContext, {
				profileId: PROFILES.alice_main.id,
				platform: "reddit",
				clientId: "test-client",
				clientSecret: "test-secret-string",
			});

			const beforeVerify = await ctx.drizzle
				.select({ updated_at: platformCredentials.updated_at })
				.from(platformCredentials)
				.where(and(eq(platformCredentials.profile_id, PROFILES.alice_main.id), eq(platformCredentials.platform, "reddit")))
				.get();

			await new Promise(resolve => setTimeout(resolve, 10));

			await markCredentialsVerified(ctx.appContext, PROFILES.alice_main.id, "reddit");

			const afterVerify = await ctx.drizzle
				.select({ updated_at: platformCredentials.updated_at })
				.from(platformCredentials)
				.where(and(eq(platformCredentials.profile_id, PROFILES.alice_main.id), eq(platformCredentials.platform, "reddit")))
				.get();

			expect(afterVerify?.updated_at).not.toBe(beforeVerify?.updated_at);
		});
	});
});
