import type { CorpusError as LibCorpusError } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { getAuth } from "./auth";
import type { Bindings } from "./bindings";
import { deleteConnection } from "./connection-delete";
import type { Database } from "./db";
import type { AppContext } from "./infrastructure";
import { type OAuthCallbackConfig, createOAuthCallback, encodeOAuthState, validateOAuthQueryKey } from "./oauth-helpers";
import { refreshAllAccounts, refreshSingleAccount } from "./refresh-service";
import { DateGroupSchema, accountMembers, accountSettings, accounts } from "./schema";
import { type CorpusError, RawDataSchema, createGitHubMetaStore, createRawStore, createRedditMetaStore, createTimelineStore } from "./storage";
import { type FetchError, type Result, encrypt, err, fetch_result, match, ok, pipe } from "./utils";

type MembershipResult = Result<{ role: string }, { status: 404 | 403; error: string; message: string }>;

const requireMembership = async (db: Database, userId: string, accountId: string, requiredRole?: "owner"): Promise<MembershipResult> => {
	const membership = await db
		.select({ role: accountMembers.role })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, userId), eq(accountMembers.account_id, accountId)))
		.get();

	if (!membership) {
		return err({ status: 404, error: "Not found", message: "Account not found or no access" });
	}

	if (requiredRole && membership.role !== requiredRole) {
		return err({ status: 403, error: "Forbidden", message: `Only ${requiredRole}s can perform this action` });
	}

	return ok({ role: membership.role });
};

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
	getSecrets: env => ({ clientId: env.REDDIT_CLIENT_ID, clientSecret: env.REDDIT_CLIENT_SECRET }),
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
	getSecrets: env => ({ clientId: env.TWITTER_CLIENT_ID, clientSecret: env.TWITTER_CLIENT_SECRET }),
	stateKeys: ["code_verifier"],
};

export const refreshRedditToken = async (refreshToken: string, clientId: string, clientSecret: string): Promise<Result<OAuthTokenResponse, FetchError>> =>
	fetch_result<OAuthTokenResponse, FetchError>(
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
authRoutes.get("/reddit", async c => {
	const ctx = getContext(c);

	const keyValidation = await validateOAuthQueryKey(c, ctx, "reddit");
	if (!keyValidation.ok) return keyValidation.error;
	const userId = keyValidation.value;

	const clientId = c.env.REDDIT_CLIENT_ID;
	if (!clientId) {
		return c.json({ error: "Reddit OAuth not configured" }, 500);
	}

	const redirectUri = `${c.env.APP_URL || "http://localhost:8787"}/api/auth/reddit/callback`;
	const state = encodeOAuthState(userId);

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

export const refreshTwitterToken = async (refreshToken: string, clientId: string, clientSecret: string): Promise<Result<OAuthTokenResponse, FetchError>> =>
	fetch_result<OAuthTokenResponse, FetchError>(
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

	const keyValidation = await validateOAuthQueryKey(c, ctx, "twitter");
	if (!keyValidation.ok) return keyValidation.error;
	const userId = keyValidation.value;

	const clientId = c.env.TWITTER_CLIENT_ID;
	if (!clientId) {
		return c.json({ error: "Twitter OAuth not configured" }, 500);
	}

	const redirectUri = `${c.env.APP_URL || "http://localhost:8787"}/api/auth/twitter/callback`;

	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	const state = encodeOAuthState(userId, { code_verifier: codeVerifier });

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
		.flat_map(encrypted_access_token =>
			body.refresh_token
				? pipe(encrypt(body.refresh_token, ctx.encryptionKey))
						.map(encrypted_refresh_token => ({ encrypted_access_token, encrypted_refresh_token: encrypted_refresh_token as string | null }))
						.result()
				: Promise.resolve(ok({ encrypted_access_token, encrypted_refresh_token: null as string | null }))
		)
		.tap(async ({ encrypted_access_token, encrypted_refresh_token }) => {
			await ctx.db.batch([
				ctx.db.insert(accounts).values({
					id: accountId,
					platform: body.platform,
					platform_user_id: body.platform_user_id ?? null,
					platform_username: body.platform_username ?? null,
					access_token_encrypted: encrypted_access_token,
					refresh_token_encrypted: encrypted_refresh_token,
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

	return match(
		await deleteConnection({ db: ctx.db, backend: ctx.backend }, accountId, auth.user_id),
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
				// Dev server doesn't have ExecutionContext - run synchronously
			}

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

connectionRoutes.post("/:account_id/members", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");
	const parseResult = AddMemberBodySchema.safeParse(await c.req.json());
	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}
	const body = parseResult.data;

	const membershipResult = await requireMembership(ctx.db, auth.user_id, accountId, "owner");
	if (!membershipResult.ok) {
		const { status, error, message } = membershipResult.error;
		return c.json({ error, message }, status);
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

	const { result, backgroundTask } = await refreshSingleAccount(ctx, accountId, auth.user_id);

	if (!result.ok) {
		const error = result.error;
		if (error.kind === "not_found") {
			return c.json({ error: "Not found", message: error.message }, 404);
		}
		if (error.kind === "inactive") {
			return c.json({ error: "Bad request", message: error.message }, 400);
		}
		return c.json({ error: "Internal error", message: error.message }, 500);
	}

	if (backgroundTask) {
		try {
			c.executionCtx.waitUntil(backgroundTask());
		} catch {
			// Dev server doesn't have ExecutionContext
		}
	}

	return c.json(result.value);
});

connectionRoutes.post("/refresh-all", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);

	const { result, backgroundTasks } = await refreshAllAccounts(ctx, auth.user_id);

	if (!result.ok) {
		return c.json({ error: "Internal error", message: "Failed to refresh accounts" }, 500);
	}

	for (const task of backgroundTasks) {
		try {
			c.executionCtx.waitUntil(task());
		} catch {
			// Dev server doesn't have ExecutionContext
		}
	}

	return c.json(result.value);
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

	const membershipResult = await requireMembership(ctx.db, auth.user_id, accountId);
	if (!membershipResult.ok) {
		const { status, error, message } = membershipResult.error;
		return c.json({ error, message }, status);
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

	const membershipResult = await requireMembership(ctx.db, auth.user_id, accountId);
	if (!membershipResult.ok) {
		const { status, error, message } = membershipResult.error;
		return c.json({ error, message }, status);
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

	const membershipResult = await requireMembership(ctx.db, auth.user_id, accountId, "owner");
	if (!membershipResult.ok) {
		const { status, error, message } = membershipResult.error;
		return c.json({ error, message }, status);
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
