import type { CorpusError as LibCorpusError } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { getAuth } from "./auth";
import type { Bindings } from "./bindings";
import { deleteConnection } from "./connection-delete";
import { processRedditAccount } from "./cron-reddit";
import type { AppContext } from "./infrastructure";
import { RedditProvider } from "./platforms/reddit";
import { DateGroupSchema, accountMembers, accountSettings, accounts } from "./schema";
import { type CorpusError, RawDataSchema, createGitHubMetaStore, createRawStore, createRedditMetaStore, createTimelineStore } from "./storage";
import { type FetchError, type Result, decrypt, encrypt, err, fetchResult, match, ok, pipe, tryCatchAsync } from "./utils";

type Variables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

const getContext = (c: Context<{ Bindings: Bindings; Variables: Variables }>): AppContext => {
	const ctx = c.get("appContext");
	if (!ctx) throw new Error("AppContext not set");
	return ctx;
};

// Helper to get frontend URL for OAuth redirects
const getFrontendUrl = (c: Context<{ Bindings: Bindings; Variables: Variables }>): string => {
	// biome-ignore lint: env access
	return (c.env as any).FRONTEND_URL || "http://localhost:4321";
};

const TimelineDataSchema = z.object({
	groups: z.array(DateGroupSchema),
});

const SnapshotMetaSchema = z
	.object({
		version: z.union([z.string(), z.number()]),
		created_at: z.union([z.string(), z.date()]),
	})
	.passthrough();

const TimelineSnapshotSchema = z.object({
	meta: SnapshotMetaSchema,
	data: TimelineDataSchema,
});

const RawSnapshotSchema = z.object({
	meta: SnapshotMetaSchema,
	data: RawDataSchema,
});

type TimelineSnapshot = z.infer<typeof TimelineSnapshotSchema>;
type RawSnapshot = z.infer<typeof RawSnapshotSchema>;

type TimelineRouteError = CorpusError | LibCorpusError | { kind: "validation_error"; message: string };
type RawRouteError = CorpusError | LibCorpusError | { kind: "validation_error"; message: string };

const CreateConnectionBodySchema = z.object({
	platform: z.enum(["github", "bluesky", "youtube", "devpad", "reddit", "twitter"]),
	access_token: z.string().min(1),
	refresh_token: z.string().optional(),
	platform_user_id: z.string().optional(),
	platform_username: z.string().optional(),
	token_expires_at: z.string().optional(),
});

const AddMemberBodySchema = z.object({
	user_id: z.string().min(1),
});

const UpdateConnectionStatusSchema = z.object({
	is_active: z.boolean(),
});

const UpdateSettingsBodySchema = z.object({
	settings: z.record(z.string(), z.unknown()),
});

export const timelineRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

timelineRoutes.get("/:user_id", async c => {
	const userId = c.req.param("user_id");
	const auth = getAuth(c);
	const ctx = getContext(c);

	if (auth.user_id !== userId) {
		return c.json({ error: "Forbidden", message: "Cannot access other user timelines" }, 403);
	}

	const from = c.req.query("from");
	const to = c.req.query("to");

	// Fetch GitHub usernames for repo owner stripping
	const githubAccounts = await ctx.db
		.select({ platform_username: accounts.platform_username })
		.from(accounts)
		.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
		.where(and(eq(accountMembers.user_id, userId), eq(accounts.platform, "github"), eq(accounts.is_active, true)));

	const githubUsernames = githubAccounts.map(a => a.platform_username).filter((u): u is string => u !== null);

	const storeResult = createTimelineStore(ctx.backend, userId);

	if (!storeResult.ok) {
		return c.json({ error: "Internal error", message: "Failed to create timeline store" }, 500);
	}

	const store = storeResult.value.store;
	const latestResult = await store.get_latest();

	if (!latestResult.ok) {
		if (latestResult.error.kind === "not_found") {
			return c.json({ error: "Not found", message: "No timeline data available" }, 404);
		}
		return c.json({ error: "Internal error", message: "Unexpected error" }, 500);
	}

	const parsed = TimelineSnapshotSchema.safeParse(latestResult.value);

	if (!parsed.success) {
		return c.json({ error: "Internal error", message: "Invalid timeline data format" }, 500);
	}

	const filteredGroups = parsed.data.data.groups.filter(group => {
		if (from && group.date < from) return false;
		if (to && group.date > to) return false;
		return true;
	});

	const result = {
		meta: { ...parsed.data.meta, github_usernames: githubUsernames },
		data: { ...parsed.data.data, groups: filteredGroups },
	};

	return c.json(result);
});

timelineRoutes.get("/:user_id/raw/:platform", async c => {
	const userId = c.req.param("user_id");
	const platform = c.req.param("platform");
	const auth = getAuth(c);
	const ctx = getContext(c);

	if (auth.user_id !== userId) {
		return c.json({ error: "Forbidden", message: "Cannot access other user data" }, 403);
	}

	const accountId = c.req.query("account_id");
	if (!accountId) {
		return c.json({ error: "Bad request", message: "account_id query parameter required" }, 400);
	}

	const result = await pipe(createRawStore(ctx.backend, platform, accountId))
		.mapErr((e): RawRouteError => e)
		.map(({ store }) => store)
		.flatMap(async (store): Promise<Result<unknown, RawRouteError>> => {
			const latest = await store.get_latest();
			if (!latest.ok) return err(latest.error);
			return ok(latest.value);
		})
		.flatMap((raw): Result<RawSnapshot, RawRouteError> => {
			const parsed = RawSnapshotSchema.safeParse(raw);
			return parsed.success ? ok(parsed.data) : err({ kind: "validation_error", message: parsed.error.message });
		})
		.map(snapshot => ({ meta: snapshot.meta, data: snapshot.data }))
		.result();

	return match(
		result,
		data => c.json(data) as Response,
		error => {
			if (error.kind === "store_not_found") {
				return c.json({ error: "Internal error", message: "Failed to create raw store" }, 500) as Response;
			}
			if (error.kind === "validation_error") {
				return c.json({ error: "Internal error", message: "Invalid raw data format" }, 500) as Response;
			}
			if (error.kind === "not_found") {
				return c.json({ error: "Not found", message: "No raw data available for this account" }, 404) as Response;
			}
			return c.json({ error: "Internal error", message: "Unexpected error" }, 500) as Response;
		}
	);
});

export const connectionRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

type OAuthTokenResponse = { access_token: string; refresh_token?: string; expires_in: number };

export const refreshRedditToken = async (refreshToken: string, clientId: string, clientSecret: string): Promise<Result<OAuthTokenResponse, FetchError>> =>
	fetchResult<OAuthTokenResponse, FetchError>(
		"https://www.reddit.com/api/v1/access_token",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
				"User-Agent": "media-timeline/2.0.0",
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
			}),
		},
		e => e
	);

// GET /auth/reddit - Initiate Reddit OAuth
// This route requires authentication via query param (for browser redirect flow)
authRoutes.get("/reddit", async c => {
	const ctx = getContext(c);

	// Get API key from query param (since this is a browser redirect, not an API call)
	const apiKey = c.req.query("key");
	if (!apiKey) {
		return c.redirect(`${getFrontendUrl(c)}/connections?error=reddit_no_auth`);
	}

	// Validate the API key
	const { hashApiKey } = await import("./utils");
	const { apiKeys } = await import("./schema");
	const keyHash = await hashApiKey(apiKey);
	const keyResult = await ctx.db.select({ user_id: apiKeys.user_id }).from(apiKeys).where(eq(apiKeys.key_hash, keyHash)).get();

	if (!keyResult) {
		return c.redirect(`${getFrontendUrl(c)}/connections?error=reddit_invalid_auth`);
	}

	const clientId = c.env.REDDIT_CLIENT_ID;
	if (!clientId) {
		return c.json({ error: "Reddit OAuth not configured" }, 500);
	}

	const redirectUri = `${c.env.APP_URL || "http://localhost:8787"}/api/auth/reddit/callback`;

	// Encode user_id in state (base64 encoded JSON with nonce for security)
	const stateData = {
		user_id: keyResult.user_id,
		nonce: crypto.randomUUID(),
	};
	const state = btoa(JSON.stringify(stateData));

	const scope = "identity,history,read";
	const authUrl = new URL("https://www.reddit.com/api/v1/authorize");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("duration", "permanent");
	authUrl.searchParams.set("scope", scope);

	return c.redirect(authUrl.toString());
});

// GET /auth/reddit/callback - Handle Reddit OAuth callback
authRoutes.get("/reddit/callback", async c => {
	const ctx = getContext(c);
	const db = ctx.db;

	const code = c.req.query("code");
	const state = c.req.query("state");
	const error = c.req.query("error");

	if (error) {
		console.error("[reddit-oauth] Authorization denied:", error);
		return c.redirect(`${getFrontendUrl(c)}/connections?error=reddit_auth_denied`);
	}

	if (!code) {
		return c.redirect(`${getFrontendUrl(c)}/connections?error=reddit_no_code`);
	}

	if (!state) {
		return c.redirect(`${getFrontendUrl(c)}/connections?error=reddit_no_state`);
	}

	// Decode user_id from state
	let userId: string;
	try {
		const stateData = JSON.parse(atob(state)) as { user_id: string; nonce: string };
		userId = stateData.user_id;
		if (!userId) throw new Error("No user_id in state");
	} catch {
		console.error("[reddit-oauth] Invalid state parameter");
		return c.redirect(`${getFrontendUrl(c)}/connections?error=reddit_invalid_state`);
	}

	const clientId = c.env.REDDIT_CLIENT_ID;
	const clientSecret = c.env.REDDIT_CLIENT_SECRET;
	const redirectUri = `${c.env.APP_URL || "http://localhost:8787"}/api/auth/reddit/callback`;

	if (!clientId || !clientSecret) {
		return c.redirect(`${getFrontendUrl(c)}/connections?error=reddit_not_configured`);
	}

	type TokenExchangeError = { kind: "token_exchange_failed"; message: string };
	type UserFetchError = { kind: "user_fetch_failed"; message: string };

	const tokenResult = await tryCatchAsync(
		async () => {
			const response = await fetch("https://www.reddit.com/api/v1/access_token", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
					"User-Agent": "media-timeline/2.0.0",
				},
				body: new URLSearchParams({
					grant_type: "authorization_code",
					code,
					redirect_uri: redirectUri,
				}),
			});
			if (!response.ok) throw new Error(`Token exchange failed: ${response.status}`);
			return response.json() as Promise<{
				access_token: string;
				refresh_token: string;
				expires_in: number;
				token_type: string;
				scope: string;
			}>;
		},
		(e): TokenExchangeError => ({ kind: "token_exchange_failed", message: String(e) })
	);

	if (!tokenResult.ok) {
		console.error("[reddit-oauth] Token exchange failed:", tokenResult.error.message);
		return c.redirect(`${getFrontendUrl(c)}/connections?error=reddit_token_failed`);
	}
	const tokens = tokenResult.value;

	const userResult = await tryCatchAsync(
		async () => {
			const response = await fetch("https://oauth.reddit.com/api/v1/me", {
				headers: {
					Authorization: `Bearer ${tokens.access_token}`,
					"User-Agent": "media-timeline/2.0.0",
				},
			});
			if (!response.ok) throw new Error(`User fetch failed: ${response.status}`);
			return response.json() as Promise<{
				id: string;
				name: string;
				icon_img?: string;
			}>;
		},
		(e): UserFetchError => ({ kind: "user_fetch_failed", message: String(e) })
	);

	if (!userResult.ok) {
		console.error("[reddit-oauth] Failed to get user info:", userResult.error.message);
		return c.redirect(`${getFrontendUrl(c)}/connections?error=reddit_user_failed`);
	}
	const userData = userResult.value;

	const existing = await db
		.select()
		.from(accounts)
		.where(and(eq(accounts.platform, "reddit"), eq(accounts.platform_user_id, userData.id)))
		.get();

	const encryptedAccessTokenResult = await encrypt(tokens.access_token, ctx.encryptionKey);
	if (!encryptedAccessTokenResult.ok) {
		console.error("[reddit-oauth] Failed to encrypt access token");
		return c.redirect(`${getFrontendUrl(c)}/connections?error=reddit_encryption_failed`);
	}

	const encryptedRefreshTokenResult = tokens.refresh_token ? await encrypt(tokens.refresh_token, ctx.encryptionKey) : null;

	const encryptedAccessToken = encryptedAccessTokenResult.value;
	const encryptedRefreshToken = encryptedRefreshTokenResult?.ok ? encryptedRefreshTokenResult.value : null;

	const now = new Date().toISOString();
	const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

	if (existing) {
		const existingMembership = await db
			.select()
			.from(accountMembers)
			.where(and(eq(accountMembers.user_id, userId), eq(accountMembers.account_id, existing.id)))
			.get();

		await db
			.update(accounts)
			.set({
				access_token_encrypted: encryptedAccessToken,
				refresh_token_encrypted: encryptedRefreshToken,
				token_expires_at: tokenExpiresAt,
				is_active: true,
				updated_at: now,
			})
			.where(eq(accounts.id, existing.id));

		if (!existingMembership) {
			await db.insert(accountMembers).values({
				id: crypto.randomUUID(),
				user_id: userId,
				account_id: existing.id,
				role: "member",
				created_at: now,
			});
		}
	} else {
		const accountId = crypto.randomUUID();
		const memberId = crypto.randomUUID();

		await db.batch([
			db.insert(accounts).values({
				id: accountId,
				platform: "reddit",
				platform_user_id: userData.id,
				platform_username: userData.name,
				access_token_encrypted: encryptedAccessToken,
				refresh_token_encrypted: encryptedRefreshToken,
				token_expires_at: tokenExpiresAt,
				is_active: true,
				created_at: now,
				updated_at: now,
			}),
			db.insert(accountMembers).values({
				id: memberId,
				user_id: userId,
				account_id: accountId,
				role: "owner",
				created_at: now,
			}),
		]);
	}

	return c.redirect(`${getFrontendUrl(c)}/connections?success=reddit`);
});

// PKCE helpers for Twitter OAuth 2.0
const base64UrlEncode = (buffer: Uint8Array): string => {
	return btoa(String.fromCharCode(...buffer))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
};

const generateCodeVerifier = (): string => {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return base64UrlEncode(array);
};

const generateCodeChallenge = async (verifier: string): Promise<string> => {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return base64UrlEncode(new Uint8Array(hash));
};

export const refreshTwitterToken = async (refreshToken: string, clientId: string, clientSecret: string): Promise<Result<OAuthTokenResponse, FetchError>> =>
	fetchResult<OAuthTokenResponse, FetchError>(
		"https://api.twitter.com/2/oauth2/token",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: clientId,
			}),
		},
		e => e
	);

// GET /auth/twitter - Initiate Twitter OAuth with PKCE
authRoutes.get("/twitter", async c => {
	const ctx = getContext(c);

	const apiKey = c.req.query("key");
	if (!apiKey) {
		return c.redirect(`${getFrontendUrl(c)}/connections?error=twitter_no_auth`);
	}

	const { hashApiKey } = await import("./utils");
	const { apiKeys } = await import("./schema");
	const keyHash = await hashApiKey(apiKey);
	const keyResult = await ctx.db.select({ user_id: apiKeys.user_id }).from(apiKeys).where(eq(apiKeys.key_hash, keyHash)).get();

	if (!keyResult) {
		return c.redirect(`${getFrontendUrl(c)}/connections?error=twitter_invalid_auth`);
	}

	const clientId = c.env.TWITTER_CLIENT_ID;
	if (!clientId) {
		return c.json({ error: "Twitter OAuth not configured" }, 500);
	}

	const redirectUri = `${c.env.APP_URL || "http://localhost:8787"}/api/auth/twitter/callback`;

	// Generate PKCE verifier and challenge
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);

	// Encode user_id and code_verifier in state
	const stateData = {
		user_id: keyResult.user_id,
		code_verifier: codeVerifier,
		nonce: crypto.randomUUID(),
	};
	const state = btoa(JSON.stringify(stateData));

	const scope = "tweet.read users.read offline.access";
	const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("scope", scope);
	authUrl.searchParams.set("code_challenge", codeChallenge);
	authUrl.searchParams.set("code_challenge_method", "S256");

	return c.redirect(authUrl.toString());
});

// GET /auth/twitter/callback - Handle Twitter OAuth callback
authRoutes.get("/twitter/callback", async c => {
	const ctx = getContext(c);
	const db = ctx.db;

	const code = c.req.query("code");
	const state = c.req.query("state");
	const error = c.req.query("error");

	if (error) {
		console.error("[twitter-oauth] Authorization denied:", error);
		return c.redirect(`${getFrontendUrl(c)}/connections?error=twitter_auth_denied`);
	}

	if (!code) {
		return c.redirect(`${getFrontendUrl(c)}/connections?error=twitter_no_code`);
	}

	if (!state) {
		return c.redirect(`${getFrontendUrl(c)}/connections?error=twitter_no_state`);
	}

	// Decode state to get user_id and code_verifier
	let userId: string;
	let codeVerifier: string;
	try {
		const stateData = JSON.parse(atob(state)) as { user_id: string; code_verifier: string; nonce: string };
		userId = stateData.user_id;
		codeVerifier = stateData.code_verifier;
		if (!userId || !codeVerifier) throw new Error("Invalid state");
	} catch {
		console.error("[twitter-oauth] Invalid state parameter");
		return c.redirect(`${getFrontendUrl(c)}/connections?error=twitter_invalid_state`);
	}

	const clientId = c.env.TWITTER_CLIENT_ID;
	const clientSecret = c.env.TWITTER_CLIENT_SECRET;
	const redirectUri = `${c.env.APP_URL || "http://localhost:8787"}/api/auth/twitter/callback`;

	if (!clientId || !clientSecret) {
		return c.redirect(`${getFrontendUrl(c)}/connections?error=twitter_not_configured`);
	}

	type TokenExchangeError = { kind: "token_exchange_failed"; message: string };
	type UserFetchError = { kind: "user_fetch_failed"; message: string };

	const tokenResult = await tryCatchAsync(
		async () => {
			const response = await fetch("https://api.twitter.com/2/oauth2/token", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
				},
				body: new URLSearchParams({
					grant_type: "authorization_code",
					code,
					redirect_uri: redirectUri,
					code_verifier: codeVerifier,
				}),
			});
			if (!response.ok) throw new Error(`Token exchange failed: ${response.status}`);
			return response.json() as Promise<{
				access_token: string;
				refresh_token?: string;
				expires_in: number;
				token_type: string;
				scope: string;
			}>;
		},
		(e): TokenExchangeError => ({ kind: "token_exchange_failed", message: String(e) })
	);

	if (!tokenResult.ok) {
		console.error("[twitter-oauth] Token exchange failed:", tokenResult.error.message);
		return c.redirect(`${getFrontendUrl(c)}/connections?error=twitter_token_failed`);
	}
	const tokens = tokenResult.value;

	const userResult = await tryCatchAsync(
		async () => {
			const response = await fetch("https://api.twitter.com/2/users/me", {
				headers: {
					Authorization: `Bearer ${tokens.access_token}`,
				},
			});
			if (!response.ok) throw new Error(`User fetch failed: ${response.status}`);
			return response.json() as Promise<{
				data: {
					id: string;
					username: string;
					name: string;
				};
			}>;
		},
		(e): UserFetchError => ({ kind: "user_fetch_failed", message: String(e) })
	);

	if (!userResult.ok) {
		console.error("[twitter-oauth] Failed to get user info:", userResult.error.message);
		return c.redirect(`${getFrontendUrl(c)}/connections?error=twitter_user_failed`);
	}
	const userData = userResult.value;

	const existing = await db
		.select()
		.from(accounts)
		.where(and(eq(accounts.platform, "twitter"), eq(accounts.platform_user_id, userData.data.id)))
		.get();

	const encryptedAccessTokenResult = await encrypt(tokens.access_token, ctx.encryptionKey);
	if (!encryptedAccessTokenResult.ok) {
		console.error("[twitter-oauth] Failed to encrypt access token");
		return c.redirect(`${getFrontendUrl(c)}/connections?error=twitter_encryption_failed`);
	}

	const encryptedRefreshTokenResult = tokens.refresh_token ? await encrypt(tokens.refresh_token, ctx.encryptionKey) : null;

	const encryptedAccessToken = encryptedAccessTokenResult.value;
	const encryptedRefreshToken = encryptedRefreshTokenResult?.ok ? encryptedRefreshTokenResult.value : null;

	const now = new Date().toISOString();
	const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

	if (existing) {
		const existingMembership = await db
			.select()
			.from(accountMembers)
			.where(and(eq(accountMembers.user_id, userId), eq(accountMembers.account_id, existing.id)))
			.get();

		await db
			.update(accounts)
			.set({
				access_token_encrypted: encryptedAccessToken,
				refresh_token_encrypted: encryptedRefreshToken,
				token_expires_at: tokenExpiresAt,
				is_active: true,
				updated_at: now,
			})
			.where(eq(accounts.id, existing.id));

		if (!existingMembership) {
			await db.insert(accountMembers).values({
				id: crypto.randomUUID(),
				user_id: userId,
				account_id: existing.id,
				role: "member",
				created_at: now,
			});
		}
	} else {
		const accountId = crypto.randomUUID();
		const memberId = crypto.randomUUID();

		await db.batch([
			db.insert(accounts).values({
				id: accountId,
				platform: "twitter",
				platform_user_id: userData.data.id,
				platform_username: userData.data.username,
				access_token_encrypted: encryptedAccessToken,
				refresh_token_encrypted: encryptedRefreshToken,
				token_expires_at: tokenExpiresAt,
				is_active: true,
				created_at: now,
				updated_at: now,
			}),
			db.insert(accountMembers).values({
				id: memberId,
				user_id: userId,
				account_id: accountId,
				role: "owner",
				created_at: now,
			}),
		]);
	}

	return c.redirect(`${getFrontendUrl(c)}/connections?success=twitter`);
});

connectionRoutes.get("/", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const includeSettings = c.req.query("include_settings") === "true";

	const results = await ctx.db
		.select({
			account_id: accounts.id,
			platform: accounts.platform,
			platform_username: accounts.platform_username,
			is_active: accounts.is_active,
			last_fetched_at: accounts.last_fetched_at,
			role: accountMembers.role,
			created_at: accountMembers.created_at,
		})
		.from(accountMembers)
		.innerJoin(accounts, eq(accountMembers.account_id, accounts.id))
		.where(eq(accountMembers.user_id, auth.user_id));

	if (!includeSettings) {
		return c.json({ accounts: results });
	}

	const accountsWithSettings = await Promise.all(
		results.map(async account => {
			const settings = await ctx.db.select().from(accountSettings).where(eq(accountSettings.account_id, account.account_id));

			const settingsMap = settings.reduce(
				(acc, s) => {
					acc[s.setting_key] = JSON.parse(s.setting_value);
					return acc;
				},
				{} as Record<string, unknown>
			);

			return { ...account, settings: settingsMap };
		})
	);

	return c.json({ accounts: accountsWithSettings });
});

connectionRoutes.post("/", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const parseResult = CreateConnectionBodySchema.safeParse(await c.req.json());
	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}
	const body = parseResult.data;

	const now = new Date().toISOString();
	const accountId = crypto.randomUUID();
	const memberId = crypto.randomUUID();

	const result = await pipe(encrypt(body.access_token, ctx.encryptionKey))
		.flatMap(encryptedAccessToken =>
			body.refresh_token
				? pipe(encrypt(body.refresh_token, ctx.encryptionKey))
						.map(encryptedRefreshToken => ({ encryptedAccessToken, encryptedRefreshToken: encryptedRefreshToken as string | null }))
						.result()
				: Promise.resolve(ok({ encryptedAccessToken, encryptedRefreshToken: null as string | null }))
		)
		.tap(async ({ encryptedAccessToken, encryptedRefreshToken }) => {
			await ctx.db.batch([
				ctx.db.insert(accounts).values({
					id: accountId,
					platform: body.platform,
					platform_user_id: body.platform_user_id ?? null,
					platform_username: body.platform_username ?? null,
					access_token_encrypted: encryptedAccessToken,
					refresh_token_encrypted: encryptedRefreshToken,
					token_expires_at: body.token_expires_at ?? null,
					is_active: true,
					created_at: now,
					updated_at: now,
				}),
				ctx.db.insert(accountMembers).values({
					id: memberId,
					user_id: auth.user_id,
					account_id: accountId,
					role: "owner",
					created_at: now,
				}),
			]);
		})
		.result();

	return match(
		result,
		() => c.json({ account_id: accountId, role: "owner" }, 201) as Response,
		() => c.json({ error: "Internal error", message: "Failed to encrypt token" }, 500) as Response
	);
});

connectionRoutes.delete("/:account_id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");

	const result = await deleteConnection({ db: ctx.db, backend: ctx.backend }, accountId, auth.user_id);

	if (!result.ok) {
		const error = result.error;
		if (error.kind === "not_found") {
			return c.json({ error: "Not found", message: "Account not found" }, 404);
		}
		if (error.kind === "forbidden") {
			return c.json({ error: "Forbidden", message: error.message }, 403);
		}
		return c.json({ error: "Internal error", message: error.message }, 500);
	}

	const { affected_users, deleted_stores, account_id, platform } = result.value;

	const regenerateTimelines = async () => {
		const { gatherLatestSnapshots, combineUserTimeline } = await import("./cron");

		for (const userId of affected_users) {
			const userAccounts = await ctx.db
				.select({
					id: accounts.id,
					platform: accounts.platform,
					platform_user_id: accounts.platform_user_id,
					access_token_encrypted: accounts.access_token_encrypted,
					refresh_token_encrypted: accounts.refresh_token_encrypted,
					user_id: accountMembers.user_id,
				})
				.from(accounts)
				.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
				.where(and(eq(accountMembers.user_id, userId), eq(accounts.is_active, true)));

			const snapshots = await gatherLatestSnapshots(ctx.backend, userAccounts);
			await combineUserTimeline(ctx.backend, userId, snapshots);
		}
	};

	// Regenerate timelines - in production use waitUntil, in dev await directly
	try {
		c.executionCtx.waitUntil(regenerateTimelines());
	} catch {
		await regenerateTimelines();
	}

	return c.json({
		deleted: true,
		account_id,
		platform,
		deleted_stores: deleted_stores.length,
		affected_users: affected_users.length,
	});
});

connectionRoutes.post("/:account_id/members", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");
	const parseResult = AddMemberBodySchema.safeParse(await c.req.json());
	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}
	const body = parseResult.data;

	const membership = await ctx.db
		.select({ role: accountMembers.role })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (membership.role !== "owner") {
		return c.json({ error: "Forbidden", message: "Only owners can add members" }, 403);
	}

	const existingMember = await ctx.db
		.select({ id: accountMembers.id })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, body.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (existingMember) {
		return c.json({ error: "Conflict", message: "User is already a member" }, 409);
	}

	const memberId = crypto.randomUUID();
	const now = new Date().toISOString();

	await ctx.db.insert(accountMembers).values({
		id: memberId,
		user_id: body.user_id,
		account_id: accountId,
		role: "member",
		created_at: now,
	});

	return c.json({ member_id: memberId, role: "member" }, 201);
});

connectionRoutes.post("/:account_id/refresh", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");

	const accountWithUser = await ctx.db
		.select({
			id: accounts.id,
			platform: accounts.platform,
			platform_user_id: accounts.platform_user_id,
			access_token_encrypted: accounts.access_token_encrypted,
			refresh_token_encrypted: accounts.refresh_token_encrypted,
			is_active: accounts.is_active,
			user_id: accountMembers.user_id,
		})
		.from(accounts)
		.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accounts.id, accountId)))
		.get();

	if (!accountWithUser) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (!accountWithUser.is_active) {
		return c.json({ error: "Bad request", message: "Account is not active" }, 400);
	}

	const { processAccount, gatherLatestSnapshots, combineUserTimeline } = await import("./cron");

	if (accountWithUser.platform === "github") {
		const backgroundTask = (async () => {
			try {
				const snapshot = await processAccount(ctx, accountWithUser);

				if (snapshot) {
					const allUserAccounts = await ctx.db
						.select({
							id: accounts.id,
							platform: accounts.platform,
							platform_user_id: accounts.platform_user_id,
							access_token_encrypted: accounts.access_token_encrypted,
							refresh_token_encrypted: accounts.refresh_token_encrypted,
							user_id: accountMembers.user_id,
						})
						.from(accounts)
						.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
						.where(and(eq(accountMembers.user_id, auth.user_id), eq(accounts.is_active, true)));

					const snapshots = await gatherLatestSnapshots(ctx.backend, allUserAccounts);
					await combineUserTimeline(ctx.backend, auth.user_id, snapshots);
				}
			} catch (error) {
				console.error("[refresh] GitHub background task failed:", error);
			}
		})();

		try {
			c.executionCtx.waitUntil(backgroundTask);
		} catch {
			// Dev server doesn't have ExecutionContext
		}

		return c.json({ status: "processing", message: "GitHub sync started in background" });
	}

	if (accountWithUser.platform === "reddit") {
		const backgroundTask = (async () => {
			try {
				const decryptResult = await decrypt(accountWithUser.access_token_encrypted, ctx.encryptionKey);
				if (!decryptResult.ok) {
					console.error("[refresh] Reddit token decryption failed");
					return;
				}

				const provider = new RedditProvider();
				const result = await processRedditAccount(ctx.backend, accountId, decryptResult.value, provider);

				if (result.ok) {
					const allUserAccounts = await ctx.db
						.select({
							id: accounts.id,
							platform: accounts.platform,
							platform_user_id: accounts.platform_user_id,
							access_token_encrypted: accounts.access_token_encrypted,
							refresh_token_encrypted: accounts.refresh_token_encrypted,
							user_id: accountMembers.user_id,
						})
						.from(accounts)
						.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
						.where(and(eq(accountMembers.user_id, auth.user_id), eq(accounts.is_active, true)));

					const snapshots = await gatherLatestSnapshots(ctx.backend, allUserAccounts);
					await combineUserTimeline(ctx.backend, auth.user_id, snapshots);
				} else {
					console.error("[refresh] Reddit refresh failed:", result.error);
				}
			} catch (error) {
				console.error("[refresh] Reddit background task failed:", error);
			}
		})();

		try {
			c.executionCtx.waitUntil(backgroundTask);
		} catch {
			// Dev server doesn't have ExecutionContext
		}

		return c.json({ status: "processing", message: "Reddit sync started in background" });
	}

	const snapshot = await processAccount(ctx, accountWithUser);

	if (snapshot) {
		const allUserAccounts = await ctx.db
			.select({
				id: accounts.id,
				platform: accounts.platform,
				platform_user_id: accounts.platform_user_id,
				access_token_encrypted: accounts.access_token_encrypted,
				refresh_token_encrypted: accounts.refresh_token_encrypted,
				user_id: accountMembers.user_id,
			})
			.from(accounts)
			.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
			.where(and(eq(accountMembers.user_id, auth.user_id), eq(accounts.is_active, true)));

		const snapshots = await gatherLatestSnapshots(ctx.backend, allUserAccounts);
		await combineUserTimeline(ctx.backend, auth.user_id, snapshots);

		return c.json({ status: "refreshed", account_id: accountId });
	}

	return c.json({ status: "skipped", message: "Rate limited or no changes" });
});

connectionRoutes.post("/refresh-all", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);

	const userAccounts = await ctx.db
		.select({
			id: accounts.id,
			platform: accounts.platform,
			platform_user_id: accounts.platform_user_id,
			access_token_encrypted: accounts.access_token_encrypted,
			refresh_token_encrypted: accounts.refresh_token_encrypted,
			user_id: accountMembers.user_id,
		})
		.from(accounts)
		.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accounts.is_active, true)));

	if (userAccounts.length === 0) {
		return c.json({ status: "completed", succeeded: 0, failed: 0, total: 0 });
	}

	const { processAccount, gatherLatestSnapshots, combineUserTimeline } = await import("./cron");

	const githubAccounts = userAccounts.filter(a => a.platform === "github");
	const redditAccounts = userAccounts.filter(a => a.platform === "reddit");
	const otherAccounts = userAccounts.filter(a => a.platform !== "github" && a.platform !== "reddit");

	if (githubAccounts.length > 0) {
		const backgroundTask = (async () => {
			let bgSucceeded = 0;

			for (const account of githubAccounts) {
				try {
					const snapshot = await processAccount(ctx, account);
					if (snapshot) bgSucceeded++;
				} catch (e) {
					console.error(`[refresh-all] Failed to refresh GitHub account ${account.id}:`, e);
				}
			}

			if (bgSucceeded > 0) {
				const snapshots = await gatherLatestSnapshots(ctx.backend, userAccounts);
				await combineUserTimeline(ctx.backend, auth.user_id, snapshots);
			}
		})();

		try {
			c.executionCtx.waitUntil(backgroundTask);
		} catch {
			// Dev server doesn't have ExecutionContext
		}
	}

	if (redditAccounts.length > 0) {
		const redditBackgroundTask = (async () => {
			let bgSucceeded = 0;

			for (const account of redditAccounts) {
				try {
					const decryptResult = await decrypt(account.access_token_encrypted, ctx.encryptionKey);
					if (!decryptResult.ok) {
						console.error("[refresh-all] Reddit token decryption failed for account:", account.id);
						continue;
					}

					const provider = new RedditProvider();
					const result = await processRedditAccount(ctx.backend, account.id, decryptResult.value, provider);
					if (result.ok) bgSucceeded++;
				} catch (e) {
					console.error(`[refresh-all] Failed to refresh Reddit account ${account.id}:`, e);
				}
			}

			if (bgSucceeded > 0) {
				const snapshots = await gatherLatestSnapshots(ctx.backend, userAccounts);
				await combineUserTimeline(ctx.backend, auth.user_id, snapshots);
			}
		})();

		try {
			c.executionCtx.waitUntil(redditBackgroundTask);
		} catch {
			// Dev server doesn't have ExecutionContext
		}
	}

	let succeeded = 0;
	let failed = 0;

	for (const account of otherAccounts) {
		try {
			const snapshot = await processAccount(ctx, account);
			if (snapshot) {
				succeeded++;
			}
		} catch (e) {
			console.error(`[refresh-all] Failed to refresh account ${account.id}:`, e);
			failed++;
		}
	}

	if (succeeded > 0) {
		const snapshots = await gatherLatestSnapshots(ctx.backend, otherAccounts);
		await combineUserTimeline(ctx.backend, auth.user_id, snapshots);
	}

	const hasBackgroundTasks = githubAccounts.length > 0 || redditAccounts.length > 0;

	return c.json({
		status: hasBackgroundTasks ? "processing" : "completed",
		message: hasBackgroundTasks ? "GitHub/Reddit accounts syncing in background" : undefined,
		succeeded,
		failed,
		total: userAccounts.length,
		github_accounts: githubAccounts.length,
		reddit_accounts: redditAccounts.length,
	});
});

connectionRoutes.patch("/:account_id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");
	const parseResult = UpdateConnectionStatusSchema.safeParse(await c.req.json());

	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}

	const body = parseResult.data;

	const membership = await ctx.db
		.select({ role: accountMembers.role })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	const now = new Date().toISOString();
	await ctx.db.update(accounts).set({ is_active: body.is_active, updated_at: now }).where(eq(accounts.id, accountId));

	const updated = await ctx.db.select().from(accounts).where(eq(accounts.id, accountId)).get();

	return c.json({ success: true, connection: updated });
});

connectionRoutes.get("/:account_id/settings", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");

	const membership = await ctx.db
		.select()
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	const settings = await ctx.db.select().from(accountSettings).where(eq(accountSettings.account_id, accountId));

	const settingsMap = settings.reduce(
		(acc, s) => {
			acc[s.setting_key] = JSON.parse(s.setting_value);
			return acc;
		},
		{} as Record<string, unknown>
	);

	return c.json({ settings: settingsMap });
});

connectionRoutes.put("/:account_id/settings", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");
	const parseResult = UpdateSettingsBodySchema.safeParse(await c.req.json());

	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}

	const body = parseResult.data;

	const membership = await ctx.db
		.select({ role: accountMembers.role })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (membership.role !== "owner") {
		return c.json({ error: "Forbidden", message: "Only owners can update settings" }, 403);
	}

	const now = new Date().toISOString();

	for (const [key, value] of Object.entries(body.settings)) {
		const existing = await ctx.db
			.select()
			.from(accountSettings)
			.where(and(eq(accountSettings.account_id, accountId), eq(accountSettings.setting_key, key)))
			.get();

		if (existing) {
			await ctx.db
				.update(accountSettings)
				.set({ setting_value: JSON.stringify(value), updated_at: now })
				.where(eq(accountSettings.id, existing.id));
		} else {
			await ctx.db.insert(accountSettings).values({
				id: crypto.randomUUID(),
				account_id: accountId,
				setting_key: key,
				setting_value: JSON.stringify(value),
				created_at: now,
				updated_at: now,
			});
		}
	}

	return c.json({ updated: true });
});

type GitHubRepoInfo = {
	full_name: string;
	name: string;
	owner: string;
	is_private: boolean;
	default_branch: string;
	pushed_at: string | null;
};

connectionRoutes.get("/:account_id/repos", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");

	const account = await ctx.db
		.select({
			id: accounts.id,
			platform: accounts.platform,
		})
		.from(accounts)
		.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accounts.id, accountId)))
		.get();

	if (!account) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (account.platform !== "github") {
		return c.json({ error: "Bad request", message: "Not a GitHub account" }, 400);
	}

	const metaStoreResult = createGitHubMetaStore(ctx.backend, accountId);
	if (!metaStoreResult.ok) {
		return c.json({ repos: [] });
	}

	const latest = await metaStoreResult.value.store.get_latest();
	if (!latest.ok) {
		return c.json({ repos: [] });
	}

	const repos: GitHubRepoInfo[] = latest.value.data.repositories.map(repo => ({
		full_name: repo.full_name,
		name: repo.name,
		owner: repo.owner,
		is_private: repo.is_private,
		default_branch: repo.default_branch,
		pushed_at: repo.pushed_at,
	}));

	return c.json({ repos });
});

connectionRoutes.get("/:account_id/subreddits", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");

	const account = await ctx.db
		.select({
			id: accounts.id,
			platform: accounts.platform,
		})
		.from(accounts)
		.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accounts.id, accountId)))
		.get();

	if (!account) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (account.platform !== "reddit") {
		return c.json({ error: "Bad request", message: "Not a Reddit account" }, 400);
	}

	const metaStoreResult = createRedditMetaStore(ctx.backend, accountId);
	if (!metaStoreResult.ok) {
		return c.json({ subreddits: [] });
	}

	const latest = await metaStoreResult.value.store.get_latest();
	if (!latest.ok || !latest.value) {
		return c.json({ subreddits: [] });
	}

	return c.json({
		subreddits: latest.value.data.subreddits_active,
		username: latest.value.data.username,
	});
});
