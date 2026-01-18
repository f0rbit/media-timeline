import { type Platform, PlatformSchema, accounts, profiles } from "@media/schema";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthContext, getAuth } from "../auth";
import type { Bindings } from "../bindings";
import { badRequest, notFound, serverError } from "../http-errors";
import type { AppContext } from "../infrastructure/context";
import { createLogger } from "../logger";
import { deleteCredentials, getCredentials, hasCredentials, markCredentialsVerified, saveCredentials } from "../services/credentials";
import { encrypt, uuid } from "../utils";
import { getContext } from "../utils/route-helpers";

const log = createLogger("credentials");

type Variables = {
	auth: AuthContext;
	appContext: AppContext;
};

const verifyProfileOwnership = async (ctx: AppContext, profileId: string, userId: string): Promise<boolean> => {
	const profile = await ctx.db.select({ user_id: profiles.user_id }).from(profiles).where(eq(profiles.id, profileId)).get();

	return profile?.user_id === userId;
};

const SaveCredentialsBodySchema = z.object({
	profile_id: z.string().min(1),
	client_id: z.string().min(1),
	client_secret: z.string().min(1),
	redirect_uri: z.string().optional(),
	reddit_username: z.string().optional(), // Required for Reddit BYO credentials
});

const REDDIT_CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{10,30}$/;
const REDDIT_SECRET_MIN_LENGTH = 20;

const validateRedditCredentialsFormat = (clientId: string, clientSecret: string): { valid: true } | { valid: false; error: string } => {
	if (!REDDIT_CLIENT_ID_PATTERN.test(clientId)) {
		return { valid: false, error: "Invalid Reddit client_id format" };
	}
	if (clientSecret.length < REDDIT_SECRET_MIN_LENGTH) {
		return { valid: false, error: "Invalid Reddit client_secret format" };
	}
	return { valid: true };
};

type RedditTokenResponse = {
	access_token: string;
	token_type: string;
	expires_in: number;
	scope: string;
};

type RedditUserResponse = {
	id: string;
	name: string;
};

/**
 * Reddit "script" apps use client credentials grant to get an access token,
 * then use that token to access the API on behalf of the app owner.
 */
const authenticateWithReddit = async (clientId: string, clientSecret: string, username: string, password: string): Promise<{ ok: true; accessToken: string; user: RedditUserResponse } | { ok: false; error: string }> => {
	// For script apps, we use password grant with the Reddit account credentials
	// But since users don't want to give us their Reddit password, we use client_credentials
	// which gives us an application-only token that can read public data

	const auth = btoa(`${clientId}:${clientSecret}`);

	// Get access token using client credentials
	const tokenResponse = await fetch("https://www.reddit.com/api/v1/access_token", {
		method: "POST",
		headers: {
			Authorization: `Basic ${auth}`,
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": "media-timeline/2.0.0",
		},
		body: new URLSearchParams({
			grant_type: "client_credentials",
		}),
	});

	if (!tokenResponse.ok) {
		const errorText = await tokenResponse.text();
		log.error("Reddit token request failed", { status: tokenResponse.status, response: errorText });
		return { ok: false, error: "Invalid Reddit credentials. Please check your Client ID and Secret." };
	}

	const tokenData = (await tokenResponse.json()) as RedditTokenResponse;

	if (!tokenData.access_token) {
		return { ok: false, error: "Failed to get access token from Reddit" };
	}

	// Note: client_credentials grant gives us an app-only token
	// We can't get the user's identity with this - we'd need to store the token
	// and use it for fetching public data only

	return {
		ok: true,
		accessToken: tokenData.access_token,
		user: { id: clientId, name: `app_${clientId.slice(0, 8)}` }, // Use client_id as identifier
	};
};

/**
 * For Reddit script apps, we authenticate and create an account entry
 * using the client credentials directly (no OAuth redirect needed).
 * The username must be provided since client_credentials grant can't access /me.
 */
const setupRedditAccount = async (ctx: AppContext, profileId: string, clientId: string, clientSecret: string, redditUsername: string): Promise<{ ok: true; accountId: string } | { ok: false; error: string }> => {
	// Authenticate with Reddit to verify credentials work
	const authResult = await authenticateWithReddit(clientId, clientSecret, "", "");

	if (!authResult.ok) {
		return authResult;
	}

	const now = new Date().toISOString();

	// Encrypt the access token for storage
	const encryptedToken = await encrypt(authResult.accessToken, ctx.encryptionKey);
	if (!encryptedToken.ok) {
		return { ok: false, error: "Failed to encrypt token" };
	}

	// Check if account already exists for this profile + platform
	const existing = await ctx.db
		.select({ id: accounts.id })
		.from(accounts)
		.where(and(eq(accounts.profile_id, profileId), eq(accounts.platform, "reddit")))
		.get();

	if (existing) {
		// Update existing account with the provided username
		await ctx.db
			.update(accounts)
			.set({
				platform_user_id: redditUsername, // Use username as ID for BYO
				platform_username: redditUsername,
				access_token_encrypted: encryptedToken.value,
				is_active: true,
				updated_at: now,
			})
			.where(eq(accounts.id, existing.id));

		return { ok: true, accountId: existing.id };
	}

	// Create new account with the provided username
	const accountId = uuid();
	await ctx.db.insert(accounts).values({
		id: accountId,
		profile_id: profileId,
		platform: "reddit",
		platform_user_id: redditUsername, // Use username as ID for BYO
		platform_username: redditUsername,
		access_token_encrypted: encryptedToken.value,
		refresh_token_encrypted: null,
		token_expires_at: null, // Client credentials tokens don't expire the same way
		is_active: true,
		created_at: now,
		updated_at: now,
	});

	return { ok: true, accountId };
};

export const credentialRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

credentialRoutes.get("/:platform", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const platformResult = PlatformSchema.safeParse(c.req.param("platform"));
	const profileId = c.req.query("profile_id");

	if (!platformResult.success) {
		return badRequest(c, "Invalid platform");
	}

	if (!profileId) {
		return badRequest(c, "profile_id is required");
	}

	const isOwner = await verifyProfileOwnership(ctx, profileId, auth.user_id);
	if (!isOwner) {
		return notFound(c, "Profile not found");
	}

	const platform = platformResult.data as Platform;
	const exists = await hasCredentials(ctx, profileId, platform);
	const credentials = exists ? await getCredentials(ctx, profileId, platform) : null;

	return c.json({
		exists,
		isVerified: credentials?.isVerified ?? false,
		clientId: credentials?.clientId ?? null,
	});
});

credentialRoutes.post("/:platform", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const platformResult = PlatformSchema.safeParse(c.req.param("platform"));

	if (!platformResult.success) {
		return badRequest(c, "Invalid platform");
	}

	const body = await c.req.json().catch(() => ({}));
	const parseResult = SaveCredentialsBodySchema.safeParse(body);

	if (!parseResult.success) {
		return badRequest(c, "profile_id, client_id, and client_secret are required", parseResult.error.flatten());
	}

	const { profile_id, client_id, client_secret, redirect_uri } = parseResult.data;

	const isOwner = await verifyProfileOwnership(ctx, profile_id, auth.user_id);
	if (!isOwner) {
		return notFound(c, "Profile not found");
	}

	const platform = platformResult.data as Platform;

	if (platform === "reddit") {
		const { reddit_username } = parseResult.data;

		// Reddit BYO requires username since client_credentials can't access /me
		if (!reddit_username?.trim()) {
			return badRequest(c, "Reddit username is required for BYO credentials");
		}

		// Validate format first
		const validation = validateRedditCredentialsFormat(client_id, client_secret);
		if (!validation.valid) {
			return badRequest(c, validation.error);
		}

		// For Reddit script apps, authenticate and create account directly
		// (no OAuth redirect needed)
		try {
			// Save credentials first
			const saveResult = await saveCredentials(ctx, {
				profileId: profile_id,
				platform,
				clientId: client_id,
				clientSecret: client_secret,
				redirectUri: redirect_uri,
			});

			// Authenticate with Reddit and create account using the provided username
			const setupResult = await setupRedditAccount(ctx, profile_id, client_id, client_secret, reddit_username.trim());

			if (!setupResult.ok) {
				// Credentials were saved but authentication failed - delete them
				await deleteCredentials(ctx, profile_id, platform);
				return badRequest(c, setupResult.error);
			}

			// Mark credentials as verified
			await markCredentialsVerified(ctx, profile_id, platform);

			return c.json({
				success: true,
				id: saveResult.id,
				accountId: setupResult.accountId,
				message: "Reddit connected successfully!",
			});
		} catch (error) {
			log.error("Reddit setup failed", { error });
			return serverError(c, "Failed to setup Reddit connection");
		}
	}

	// For other platforms, just save credentials (they'll use OAuth flow)
	try {
		const result = await saveCredentials(ctx, {
			profileId: profile_id,
			platform,
			clientId: client_id,
			clientSecret: client_secret,
			redirectUri: redirect_uri,
		});

		return c.json({
			success: true,
			id: result.id,
			message: `Credentials saved. Click 'Connect with ${platform.charAt(0).toUpperCase() + platform.slice(1)}' to complete setup.`,
		});
	} catch (error) {
		log.error("Failed to save credentials", { error });
		return serverError(c, "Failed to save credentials");
	}
});

credentialRoutes.delete("/:platform", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const platformResult = PlatformSchema.safeParse(c.req.param("platform"));
	const profileId = c.req.query("profile_id");

	if (!platformResult.success) {
		return badRequest(c, "Invalid platform");
	}

	if (!profileId) {
		return badRequest(c, "profile_id is required");
	}

	const isOwner = await verifyProfileOwnership(ctx, profileId, auth.user_id);
	if (!isOwner) {
		return notFound(c, "Profile not found");
	}

	const platform = platformResult.data as Platform;
	const deleted = await deleteCredentials(ctx, profileId, platform);

	return c.json({
		success: deleted,
		message: deleted ? "Credentials deleted" : "No credentials found",
	});
});
