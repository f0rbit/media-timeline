import type { CorpusError as LibCorpusError } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { getAuth } from "./auth";
import { requireAccountOwnership } from "./auth-ownership";
import type { Bindings } from "./bindings";
import { deleteConnection } from "./connection-delete";
import { badRequest, forbidden, notFound, serverError } from "./http-errors";
import type { AppContext } from "./infrastructure";
import { type OAuthCallbackConfig, createOAuthCallback, encodeOAuthState, validateOAuthQueryKeyAndProfile } from "./oauth-helpers";
import { refreshAllAccounts, refreshSingleAccount } from "./refresh-service";
import { DateGroupSchema, PlatformSchema, accountId, accountSettings, accounts, profiles, userId } from "./schema";
import { type CorpusError, RawDataSchema, createGitHubMetaStore, createRawStore, createRedditMetaStore, createTimelineStore } from "./storage";
import { type FetchError, type Result, encrypt, err, match, ok, parseSettingsMap, pipe, safeWaitUntil, uuid } from "./utils";

type Variables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

const getContext = (c: Context<{ Bindings: Bindings; Variables: Variables }>): AppContext => {
	const ctx = c.get("appContext");
	if (!ctx) throw new Error("AppContext not set");
	return ctx;
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

type TimelineGetError = { kind: "store_error"; status: 500 } | { kind: "not_found"; status: 404 } | { kind: "parse_error"; status: 500 };

type RawRouteError = CorpusError | LibCorpusError | { kind: "validation_error"; message: string };

const CreateConnectionBodySchema = z.object({
	profile_id: z.string().min(1),
	platform: PlatformSchema,
	access_token: z.string().min(1),
	refresh_token: z.string().optional(),
	platform_user_id: z.string().optional(),
	platform_username: z.string().optional(),
	token_expires_at: z.string().optional(),
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
		return forbidden(c, "Cannot access other user timelines");
	}

	const from = c.req.query("from");
	const to = c.req.query("to");

	const githubAccounts = await ctx.db
		.select({ platform_username: accounts.platform_username })
		.from(accounts)
		.innerJoin(profiles, eq(accounts.profile_id, profiles.id))
		.where(and(eq(profiles.user_id, userId), eq(accounts.platform, "github"), eq(accounts.is_active, true)));

	const githubUsernames = githubAccounts.map(a => a.platform_username).filter((u): u is string => u !== null);

	const result = await pipe(createTimelineStore(ctx.backend, userId))
		.map_err((): TimelineGetError => ({ kind: "store_error", status: 500 }))
		.map(({ store }) => store)
		.flat_map(async (store): Promise<Result<TimelineSnapshot, TimelineGetError>> => {
			const latest = await store.get_latest();
			if (!latest.ok) {
				return latest.error.kind === "not_found" ? err({ kind: "not_found" as const, status: 404 as const }) : err({ kind: "store_error" as const, status: 500 as const });
			}
			return ok(latest.value as TimelineSnapshot);
		})
		.flat_map((raw): Result<TimelineSnapshot, TimelineGetError> => {
			const parsed = TimelineSnapshotSchema.safeParse(raw);
			return parsed.success ? ok(parsed.data) : err({ kind: "parse_error" as const, status: 500 as const });
		})
		.map(snapshot => {
			const filteredGroups = snapshot.data.groups.filter(group => {
				if (from && group.date < from) return false;
				if (to && group.date > to) return false;
				return true;
			});
			return {
				meta: { ...snapshot.meta, github_usernames: githubUsernames },
				data: { ...snapshot.data, groups: filteredGroups },
			};
		})
		.result();

	return match(
		result,
		data => c.json(data) as Response,
		error => {
			const messages: Record<TimelineGetError["kind"], string> = {
				store_error: "Failed to create timeline store",
				not_found: "No timeline data available",
				parse_error: "Invalid timeline data format",
			};
			const errorLabels: Record<TimelineGetError["kind"], string> = {
				store_error: "Internal error",
				not_found: "Not found",
				parse_error: "Internal error",
			};
			return c.json({ error: errorLabels[error.kind], message: messages[error.kind] }, error.status) as Response;
		}
	);
});

timelineRoutes.get("/:user_id/raw/:platform", async c => {
	const userId = c.req.param("user_id");
	const platform = c.req.param("platform");
	const auth = getAuth(c);
	const ctx = getContext(c);

	if (auth.user_id !== userId) {
		return forbidden(c, "Cannot access other user data");
	}

	const accountId = c.req.query("account_id");
	if (!accountId) {
		return badRequest(c, "account_id query parameter required");
	}

	const result = await pipe(createRawStore(ctx.backend, platform, accountId))
		.map_err((e): RawRouteError => e)
		.map(({ store }) => store)
		.flat_map(async (store): Promise<Result<unknown, RawRouteError>> => {
			const latest = await store.get_latest();
			if (!latest.ok) return err(latest.error);
			return ok(latest.value);
		})
		.flat_map((raw): Result<RawSnapshot, RawRouteError> => {
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

// === Platform OAuth Configs ===

const redditOAuthConfig: OAuthCallbackConfig = {
	platform: "reddit",
	tokenUrl: "https://www.reddit.com/api/v1/access_token",
	tokenAuthHeader: (id, secret) => `Basic ${btoa(`${id}:${secret}`)}`,
	tokenHeaders: { "User-Agent": "media-timeline/2.0.0" },
	tokenBody: (code, redirectUri) =>
		new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
		}),
	fetchUser: async (token): Promise<{ id: string; username: string }> => {
		const response = await fetch("https://oauth.reddit.com/api/v1/me", {
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "media-timeline/2.0.0",
			},
		});
		if (!response.ok) throw new Error(`User fetch failed: ${response.status}`);
		const data = (await response.json()) as { id: string; name: string };
		return { id: data.id, username: data.name };
	},
	getSecrets: env => ({ clientId: env.MEDIA_REDDIT_CLIENT_ID, clientSecret: env.MEDIA_REDDIT_CLIENT_SECRET }),
};

const twitterOAuthConfig: OAuthCallbackConfig<{ code_verifier: string }> = {
	platform: "twitter",
	tokenUrl: "https://api.twitter.com/2/oauth2/token",
	tokenAuthHeader: (id, secret) => `Basic ${btoa(`${id}:${secret}`)}`,
	tokenBody: (code, redirectUri, state) =>
		new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			code_verifier: state.code_verifier,
		}),
	fetchUser: async (token): Promise<{ id: string; username: string }> => {
		const response = await fetch("https://api.twitter.com/2/users/me", {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!response.ok) throw new Error(`User fetch failed: ${response.status}`);
		const data = (await response.json()) as { data: { id: string; username: string } };
		return { id: data.data.id, username: data.data.username };
	},
	getSecrets: env => ({ clientId: env.MEDIA_TWITTER_CLIENT_ID, clientSecret: env.MEDIA_TWITTER_CLIENT_SECRET }),
	stateKeys: ["code_verifier"],
};

export const refreshRedditToken = (refreshToken: string, clientId: string, clientSecret: string): Promise<Result<OAuthTokenResponse, FetchError>> =>
	pipe
		.fetch<OAuthTokenResponse, FetchError>(
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
		)
		.result();

// GET /auth/reddit - Initiate Reddit OAuth
authRoutes.get("/reddit", async c => {
	const ctx = getContext(c);

	const validation = await validateOAuthQueryKeyAndProfile(c, ctx, "reddit");
	if (!validation.ok) return validation.error;
	const { user_id, profile_id } = validation.value;

	const clientId = c.env.MEDIA_REDDIT_CLIENT_ID;
	if (!clientId) {
		return c.json({ error: "Reddit OAuth not configured" }, 500);
	}

	const redirectUri = `${c.env.MEDIA_API_URL || "http://localhost:8787"}/media/api/auth/reddit/callback`;
	const state = encodeOAuthState(user_id, profile_id);

	const authUrl = new URL("https://www.reddit.com/api/v1/authorize");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("duration", "permanent");
	authUrl.searchParams.set("scope", "identity,history,read");

	return c.redirect(authUrl.toString());
});

// GET /auth/reddit/callback - Handle Reddit OAuth callback
authRoutes.get("/reddit/callback", createOAuthCallback(redditOAuthConfig));

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

export const refreshTwitterToken = (refreshToken: string, clientId: string, clientSecret: string): Promise<Result<OAuthTokenResponse, FetchError>> =>
	pipe
		.fetch<OAuthTokenResponse, FetchError>(
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
		)
		.result();

// GET /auth/twitter - Initiate Twitter OAuth with PKCE
authRoutes.get("/twitter", async c => {
	const ctx = getContext(c);

	const validation = await validateOAuthQueryKeyAndProfile(c, ctx, "twitter");
	if (!validation.ok) return validation.error;
	const { user_id, profile_id } = validation.value;

	const clientId = c.env.MEDIA_TWITTER_CLIENT_ID;
	if (!clientId) {
		return c.json({ error: "Twitter OAuth not configured" }, 500);
	}

	const redirectUri = `${c.env.MEDIA_API_URL || "http://localhost:8787"}/media/api/auth/twitter/callback`;

	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	const state = encodeOAuthState(user_id, profile_id, { code_verifier: codeVerifier });

	const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("scope", "tweet.read users.read offline.access");
	authUrl.searchParams.set("code_challenge", codeChallenge);
	authUrl.searchParams.set("code_challenge_method", "S256");

	return c.redirect(authUrl.toString());
});

// GET /auth/twitter/callback - Handle Twitter OAuth callback
authRoutes.get("/twitter/callback", createOAuthCallback(twitterOAuthConfig));

// === GitHub OAuth ===

const githubOAuthConfig: OAuthCallbackConfig = {
	platform: "github",
	tokenUrl: "https://github.com/login/oauth/access_token",
	tokenAuthHeader: () => "",
	tokenHeaders: { Accept: "application/json" },
	tokenBody: (code, redirectUri) =>
		new URLSearchParams({
			client_id: "",
			client_secret: "",
			code,
			redirect_uri: redirectUri,
		}),
	fetchUser: async (token): Promise<{ id: string; username: string }> => {
		const response = await fetch("https://api.github.com/user", {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
				"User-Agent": "media-timeline/2.0.0",
			},
		});
		if (!response.ok) throw new Error(`User fetch failed: ${response.status}`);
		const data = (await response.json()) as { id: number; login: string };
		return { id: String(data.id), username: data.login };
	},
	getSecrets: env => ({ clientId: env.MEDIA_GITHUB_CLIENT_ID, clientSecret: env.MEDIA_GITHUB_CLIENT_SECRET }),
};

// GET /auth/github - Initiate GitHub OAuth
authRoutes.get("/github", async c => {
	const ctx = getContext(c);

	const validation = await validateOAuthQueryKeyAndProfile(c, ctx, "github");
	if (!validation.ok) return validation.error;
	const { user_id, profile_id } = validation.value;

	const clientId = c.env.MEDIA_GITHUB_CLIENT_ID;
	if (!clientId) {
		return c.json({ error: "GitHub OAuth not configured" }, 500);
	}

	const redirectUri = `${c.env.MEDIA_API_URL || "http://localhost:8787"}/media/api/auth/github/callback`;
	const state = encodeOAuthState(user_id, profile_id);

	const authUrl = new URL("https://github.com/login/oauth/authorize");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("scope", "read:user repo");
	authUrl.searchParams.set("state", state);

	return c.redirect(authUrl.toString());
});

// GET /auth/github/callback - Handle GitHub OAuth callback
authRoutes.get("/github/callback", async c => {
	const ctx = getContext(c);
	if (!ctx) throw new Error("AppContext not set");

	const clientId = c.env.MEDIA_GITHUB_CLIENT_ID;
	const clientSecret = c.env.MEDIA_GITHUB_CLIENT_SECRET;

	const configWithSecrets: OAuthCallbackConfig = {
		...githubOAuthConfig,
		tokenBody: (code, redirectUri) =>
			new URLSearchParams({
				client_id: clientId || "",
				client_secret: clientSecret || "",
				code,
				redirect_uri: redirectUri,
			}),
	};

	return createOAuthCallback(configWithSecrets)(c);
});

connectionRoutes.get("/", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const includeSettings = c.req.query("include_settings") === "true";
	const profileId = c.req.query("profile_id");

	if (!profileId) {
		return badRequest(c, "profile_id query parameter required");
	}

	const profile = await ctx.db.select({ id: profiles.id, user_id: profiles.user_id }).from(profiles).where(eq(profiles.id, profileId)).get();

	if (!profile) {
		return notFound(c, "Profile not found");
	}

	if (profile.user_id !== auth.user_id) {
		return forbidden(c, "You do not own this profile");
	}

	const results = await ctx.db
		.select({
			account_id: accounts.id,
			profile_id: accounts.profile_id,
			platform: accounts.platform,
			platform_username: accounts.platform_username,
			is_active: accounts.is_active,
			last_fetched_at: accounts.last_fetched_at,
			created_at: accounts.created_at,
		})
		.from(accounts)
		.where(eq(accounts.profile_id, profileId));

	if (!includeSettings) {
		return c.json({ accounts: results });
	}

	const accountsWithSettings = await Promise.all(
		results.map(async account => {
			const settings = await ctx.db.select().from(accountSettings).where(eq(accountSettings.account_id, account.account_id));

			const settingsMap = parseSettingsMap(settings);

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
		return badRequest(c, "Invalid request body", parseResult.error.flatten());
	}
	const body = parseResult.data;

	const profile = await ctx.db.select({ id: profiles.id, user_id: profiles.user_id }).from(profiles).where(eq(profiles.id, body.profile_id)).get();

	if (!profile) {
		return notFound(c, "Profile not found");
	}

	if (profile.user_id !== auth.user_id) {
		return forbidden(c, "You do not own this profile");
	}

	const now = new Date().toISOString();
	const accountId = uuid();

	const result = await pipe(encrypt(body.access_token, ctx.encryptionKey))
		.flat_map(encrypted_access_token =>
			body.refresh_token
				? pipe(encrypt(body.refresh_token, ctx.encryptionKey))
						.map(encrypted_refresh_token => ({ encrypted_access_token, encrypted_refresh_token: encrypted_refresh_token as string | null }))
						.result()
				: Promise.resolve(ok({ encrypted_access_token, encrypted_refresh_token: null as string | null }))
		)
		.tap(async ({ encrypted_access_token, encrypted_refresh_token }) => {
			await ctx.db.insert(accounts).values({
				id: accountId,
				profile_id: body.profile_id,
				platform: body.platform,
				platform_user_id: body.platform_user_id ?? null,
				platform_username: body.platform_username ?? null,
				access_token_encrypted: encrypted_access_token,
				refresh_token_encrypted: encrypted_refresh_token,
				token_expires_at: body.token_expires_at ?? null,
				is_active: true,
				created_at: now,
				updated_at: now,
			});
		})
		.result();

	return match(
		result,
		() => c.json({ account_id: accountId, profile_id: body.profile_id }, 201) as Response,
		() => serverError(c, "Failed to encrypt token") as Response
	);
});

connectionRoutes.delete("/:account_id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accId = accountId(c.req.param("account_id"));
	const uid = userId(auth.user_id);

	const ownershipResult = await requireAccountOwnership(ctx.db, uid, accId);
	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	return match(
		await deleteConnection({ db: ctx.db, backend: ctx.backend }, accId, uid),
		({ affected_users, deleted_stores, account_id, platform }) => {
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
							user_id: profiles.user_id,
						})
						.from(accounts)
						.innerJoin(profiles, eq(accounts.profile_id, profiles.id))
						.where(and(eq(profiles.user_id, userId), eq(accounts.is_active, true)));

					const snapshots = await gatherLatestSnapshots(ctx.backend, userAccounts);
					await combineUserTimeline(ctx.backend, userId, snapshots);
				}
			};

			safeWaitUntil(c, regenerateTimelines, "connection-delete");

			return c.json({
				deleted: true,
				account_id,
				platform,
				deleted_stores: deleted_stores.length,
				affected_users: affected_users.length,
			}) as Response;
		},
		error => {
			const errorMap: Record<string, { status: number; label: string }> = {
				not_found: { status: 404, label: "Not found" },
				forbidden: { status: 403, label: "Forbidden" },
			};
			const { status, label } = errorMap[error.kind] ?? { status: 500, label: "Internal error" };
			const message = "message" in error ? error.message : "Account not found";
			return c.json({ error: label, message }, status as 404 | 403 | 500) as Response;
		}
	);
});

connectionRoutes.post("/:account_id/refresh", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");

	const { result, backgroundTask } = await refreshSingleAccount(ctx, accountId, auth.user_id);

	if (!result.ok) {
		const error = result.error;
		if (error.kind === "not_found") {
			return notFound(c, error.message);
		}
		if (error.kind === "inactive") {
			return badRequest(c, error.message);
		}
		return serverError(c, error.message);
	}

	if (backgroundTask) {
		safeWaitUntil(c, backgroundTask, "refresh");
	}

	return c.json(result.value);
});

connectionRoutes.post("/refresh-all", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);

	const { result, backgroundTasks } = await refreshAllAccounts(ctx, auth.user_id);

	if (!result.ok) {
		return serverError(c, "Failed to refresh accounts");
	}

	for (const task of backgroundTasks) {
		safeWaitUntil(c, task, "refresh-all");
	}

	return c.json(result.value);
});

connectionRoutes.patch("/:account_id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accId = accountId(c.req.param("account_id"));
	const parseResult = UpdateConnectionStatusSchema.safeParse(await c.req.json());

	if (!parseResult.success) {
		return badRequest(c, "Invalid request body", parseResult.error.flatten());
	}

	const body = parseResult.data;

	const ownershipResult = await requireAccountOwnership(ctx.db, userId(auth.user_id), accId);
	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	const now = new Date().toISOString();
	await ctx.db.update(accounts).set({ is_active: body.is_active, updated_at: now }).where(eq(accounts.id, accId));

	const updated = await ctx.db.select().from(accounts).where(eq(accounts.id, accId)).get();

	return c.json({ success: true, connection: updated });
});

connectionRoutes.get("/:account_id/settings", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accId = accountId(c.req.param("account_id"));

	const ownershipResult = await requireAccountOwnership(ctx.db, userId(auth.user_id), accId);
	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	const settings = await ctx.db.select().from(accountSettings).where(eq(accountSettings.account_id, accId));

	const settingsMap = parseSettingsMap(settings);

	return c.json({ settings: settingsMap });
});

connectionRoutes.put("/:account_id/settings", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accId = accountId(c.req.param("account_id"));
	const parseResult = UpdateSettingsBodySchema.safeParse(await c.req.json());

	if (!parseResult.success) {
		return badRequest(c, "Invalid request body", parseResult.error.flatten());
	}

	const body = parseResult.data;

	const ownershipResult = await requireAccountOwnership(ctx.db, userId(auth.user_id), accId);
	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	const now = new Date().toISOString();

	for (const [key, value] of Object.entries(body.settings)) {
		const existing = await ctx.db
			.select()
			.from(accountSettings)
			.where(and(eq(accountSettings.account_id, accId), eq(accountSettings.setting_key, key)))
			.get();

		if (existing) {
			await ctx.db
				.update(accountSettings)
				.set({ setting_value: JSON.stringify(value), updated_at: now })
				.where(eq(accountSettings.id, existing.id));
		} else {
			await ctx.db.insert(accountSettings).values({
				id: uuid(),
				account_id: accId,
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
	const accId = accountId(c.req.param("account_id"));

	const ownershipResult = await requireAccountOwnership(ctx.db, userId(auth.user_id), accId);
	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	const account = await ctx.db.select({ id: accounts.id, platform: accounts.platform }).from(accounts).where(eq(accounts.id, accId)).get();

	if (!account) {
		return notFound(c, "Account not found");
	}

	if (account.platform !== "github") {
		return badRequest(c, "Not a GitHub account");
	}

	const metaStoreResult = createGitHubMetaStore(ctx.backend, accId);
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
	const accId = accountId(c.req.param("account_id"));

	const ownershipResult = await requireAccountOwnership(ctx.db, userId(auth.user_id), accId);
	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	const account = await ctx.db.select({ id: accounts.id, platform: accounts.platform }).from(accounts).where(eq(accounts.id, accId)).get();

	if (!account) {
		return notFound(c, "Account not found");
	}

	if (account.platform !== "reddit") {
		return badRequest(c, "Not a Reddit account");
	}

	const metaStoreResult = createRedditMetaStore(ctx.backend, accId);
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

export { profileRoutes } from "./routes-profiles";
