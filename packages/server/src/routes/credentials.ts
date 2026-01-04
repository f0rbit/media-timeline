import { type Platform, PlatformSchema, profiles } from "@media/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthContext, getAuth } from "../auth";
import type { Bindings } from "../bindings";
import { badRequest, notFound, serverError } from "../http-errors";
import type { AppContext } from "../infrastructure";
import { deleteCredentials, getCredentials, hasCredentials, saveCredentials } from "../services/credentials";

type Variables = {
	auth: AuthContext;
	appContext: AppContext;
};

const getContext = (c: { get: (k: "appContext") => AppContext }): AppContext => {
	const ctx = c.get("appContext");
	if (!ctx) throw new Error("AppContext not set");
	return ctx;
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
});

const REDDIT_CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{14,30}$/;
const REDDIT_SECRET_MIN_LENGTH = 20;

const validateRedditCredentials = (clientId: string, clientSecret: string): { valid: true } | { valid: false; error: string } => {
	if (!REDDIT_CLIENT_ID_PATTERN.test(clientId)) {
		return { valid: false, error: "Invalid Reddit client_id format" };
	}
	if (clientSecret.length < REDDIT_SECRET_MIN_LENGTH) {
		return { valid: false, error: "Invalid Reddit client_secret format" };
	}
	return { valid: true };
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
		const validation = validateRedditCredentials(client_id, client_secret);
		if (!validation.valid) {
			return badRequest(c, validation.error);
		}
	}

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
		console.error("[credentials] Failed to save:", error);
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
