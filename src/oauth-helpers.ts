import { and, eq, or } from "drizzle-orm";
import type { Context } from "hono";
import type { Bindings } from "./bindings";
import type { Database } from "./db";
import type { AppContext } from "./infrastructure";
import { type Platform, accounts, apiKeys, profiles } from "./schema";
import { type Result, encrypt, err, hash_api_key, ok, pipe, to_nullable, try_catch, try_catch_async, uuid } from "./utils";

type Variables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

type HonoContext = Context<{ Bindings: Bindings; Variables: Variables }>;

export type OAuthStateBase = { user_id: string; profile_id: string; nonce: string };
export type OAuthState<T extends Record<string, unknown> = Record<string, never>> = OAuthStateBase & T;

export type TokenResponse = {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type: string;
	scope: string;
};

// Pure function error types
export type DecodeStateError = { kind: "no_state" } | { kind: "invalid_base64" } | { kind: "invalid_json" } | { kind: "missing_user_id" } | { kind: "missing_profile_id" } | { kind: "missing_required_key"; key: string };

export type TokenValidationError = { kind: "missing_access_token" } | { kind: "invalid_token_type"; got: string };

export type ValidatedTokens = {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type: string;
	scope?: string;
};

// Pure function: decode OAuth state data without Response/HonoContext dependency
export const decodeOAuthStateData = <T extends Record<string, unknown>>(state: string | undefined, requiredKeys: (keyof T)[] = []): Result<OAuthState<T>, DecodeStateError> => {
	if (!state) return err({ kind: "no_state" });

	const base64Result = try_catch(
		() => atob(state),
		(): DecodeStateError => ({ kind: "invalid_base64" })
	);
	if (!base64Result.ok) return base64Result;

	const jsonResult = try_catch(
		() => JSON.parse(base64Result.value) as OAuthState<T>,
		(): DecodeStateError => ({ kind: "invalid_json" })
	);
	if (!jsonResult.ok) return jsonResult;

	const stateData = jsonResult.value;

	if (!stateData.user_id) return err({ kind: "missing_user_id" });
	if (!stateData.profile_id) return err({ kind: "missing_profile_id" });

	for (const key of requiredKeys) {
		if (!stateData[key]) return err({ kind: "missing_required_key", key: String(key) });
	}

	return ok(stateData);
};

// Pure function: calculate token expiry with injectable "now" for testing
export const calculateTokenExpiry = (expiresIn: number | undefined, now: Date = new Date()): string | null => (expiresIn ? new Date(now.getTime() + expiresIn * 1000).toISOString() : null);

// Pure function: validate token response structure
export const validateTokenResponse = (response: unknown): Result<ValidatedTokens, TokenValidationError> => {
	if (typeof response !== "object" || response === null) {
		return err({ kind: "missing_access_token" });
	}

	const obj = response as Record<string, unknown>;

	if (typeof obj.access_token !== "string" || obj.access_token === "") {
		return err({ kind: "missing_access_token" });
	}

	if (obj.token_type !== undefined && typeof obj.token_type !== "string") {
		return err({ kind: "invalid_token_type", got: String(obj.token_type) });
	}

	const tokenType = (obj.token_type as string) || "Bearer";
	const normalizedTokenType = tokenType.toLowerCase();
	if (normalizedTokenType !== "bearer" && normalizedTokenType !== "mac") {
		return err({ kind: "invalid_token_type", got: tokenType });
	}

	return ok({
		access_token: obj.access_token,
		refresh_token: typeof obj.refresh_token === "string" ? obj.refresh_token : undefined,
		expires_in: typeof obj.expires_in === "number" ? obj.expires_in : undefined,
		token_type: tokenType,
		scope: typeof obj.scope === "string" ? obj.scope : undefined,
	});
};

export type OAuthUser = {
	id: string;
	username: string;
};

export type OAuthError = { kind: "token_exchange_failed"; message: string } | { kind: "user_fetch_failed"; message: string } | { kind: "encryption_failed"; message: string } | { kind: "database_failed"; message: string };

export type OAuthCallbackConfig<TState extends Record<string, unknown> = Record<string, never>> = {
	platform: Platform;
	tokenUrl: string;
	tokenAuthHeader: (clientId: string, clientSecret: string) => string;
	tokenHeaders?: Record<string, string>;
	tokenBody: (code: string, redirectUri: string, state: OAuthState<TState>) => URLSearchParams;
	fetchUser: (accessToken: string) => Promise<OAuthUser>;
	getSecrets: (env: Bindings) => { clientId: string | undefined; clientSecret: string | undefined };
	stateKeys?: (keyof TState)[];
};

export const getFrontendUrl = (c: HonoContext): string => c.env.MEDIA_FRONTEND_URL || "http://localhost:4321";

export const validateOAuthQueryKey = async (c: HonoContext, ctx: AppContext, platform: string): Promise<Result<string, Response>> => {
	const apiKey = c.req.query("key");
	if (!apiKey) {
		return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_no_auth`));
	}

	const keyHash = await hash_api_key(apiKey);
	const keyResult = await ctx.db.select({ user_id: apiKeys.user_id }).from(apiKeys).where(eq(apiKeys.key_hash, keyHash)).get();

	if (!keyResult) {
		return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_invalid_auth`));
	}

	return ok(keyResult.user_id);
};

export type OAuthKeyAndProfileResult = { user_id: string; profile_id: string };

export const validateOAuthQueryKeyAndProfile = async (c: HonoContext, ctx: AppContext, platform: string): Promise<Result<OAuthKeyAndProfileResult, Response>> => {
	const apiKey = c.req.query("key");
	if (!apiKey) {
		return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_no_auth`));
	}

	const profileIdOrSlug = c.req.query("profile_id") || c.req.query("profile");
	if (!profileIdOrSlug) {
		return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_no_profile`));
	}

	const keyHash = await hash_api_key(apiKey);
	const keyResult = await ctx.db.select({ user_id: apiKeys.user_id }).from(apiKeys).where(eq(apiKeys.key_hash, keyHash)).get();

	if (!keyResult) {
		return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_invalid_auth`));
	}

	const userId = keyResult.user_id;

	const profile = await ctx.db
		.select({ id: profiles.id, user_id: profiles.user_id })
		.from(profiles)
		.where(and(eq(profiles.user_id, userId), or(eq(profiles.id, profileIdOrSlug), eq(profiles.slug, profileIdOrSlug))))
		.get();

	if (!profile) {
		return err(c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_invalid_profile`));
	}

	return ok({ user_id: userId, profile_id: profile.id });
};

export const redirectWithError = (c: HonoContext, platform: Platform, errorCode: string): Response => c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_${errorCode}`);

export const redirectWithSuccess = (c: HonoContext, platform: Platform): Response => c.redirect(`${getFrontendUrl(c)}/connections?success=${platform}`);

export const encodeOAuthState = <T extends Record<string, unknown>>(userId: string, profileId: string, extra?: T): string => {
	const stateData: OAuthState<T> = {
		user_id: userId,
		profile_id: profileId,
		nonce: uuid(),
		...(extra as T),
	};
	return btoa(JSON.stringify(stateData));
};

export const decodeOAuthState = <T extends Record<string, unknown> = Record<string, never>>(c: HonoContext, state: string | undefined, platform: Platform, requiredKeys: (keyof T)[] = []): Result<OAuthState<T>, Response> => {
	const result = decodeOAuthStateData<T>(state, requiredKeys);

	if (!result.ok) {
		const errorCode = result.error.kind === "no_state" ? "no_state" : "invalid_state";
		if (errorCode === "invalid_state") {
			console.error(`[${platform}-oauth] Invalid state parameter`);
		}
		return err(redirectWithError(c, platform, errorCode));
	}

	return ok(result.value);
};

export const validateOAuthRequest = <TState extends Record<string, unknown>>(
	c: HonoContext,
	config: OAuthCallbackConfig<TState>
): Result<{ code: string; stateData: OAuthState<TState>; redirectUri: string; clientId: string; clientSecret: string }, Response> => {
	const code = c.req.query("code");
	const error = c.req.query("error");

	if (error) {
		console.error(`[${config.platform}-oauth] Authorization denied:`, error);
		return err(redirectWithError(c, config.platform, "auth_denied"));
	}

	if (!code) {
		return err(redirectWithError(c, config.platform, "no_code"));
	}

	const stateResult = decodeOAuthState<TState>(c, c.req.query("state"), config.platform, config.stateKeys);
	if (!stateResult.ok) return err(stateResult.error);

	const { clientId, clientSecret } = config.getSecrets(c.env);
	const redirectUri = `${c.env.MEDIA_API_URL || "http://localhost:8787"}/api/auth/${config.platform}/callback`;

	if (!clientId || !clientSecret) {
		return err(redirectWithError(c, config.platform, "not_configured"));
	}

	return ok({ code, stateData: stateResult.value, redirectUri, clientId, clientSecret });
};

export const exchangeCodeForTokens = async <TState extends Record<string, unknown>>(
	code: string,
	redirectUri: string,
	clientId: string,
	clientSecret: string,
	config: OAuthCallbackConfig<TState>,
	stateData: OAuthState<TState>
): Promise<Result<TokenResponse, OAuthError>> =>
	try_catch_async(
		async () => {
			const response = await fetch(config.tokenUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Authorization: config.tokenAuthHeader(clientId, clientSecret),
					...config.tokenHeaders,
				},
				body: config.tokenBody(code, redirectUri, stateData),
			});
			if (!response.ok) throw new Error(`Token exchange failed: ${response.status}`);
			return response.json() as Promise<TokenResponse>;
		},
		(e): OAuthError => ({ kind: "token_exchange_failed", message: String(e) })
	);

export const fetchOAuthUserProfile = async <TState extends Record<string, unknown>>(accessToken: string, config: OAuthCallbackConfig<TState>): Promise<Result<OAuthUser, OAuthError>> =>
	try_catch_async(
		() => config.fetchUser(accessToken),
		(e): OAuthError => ({ kind: "user_fetch_failed", message: String(e) })
	);

type EncryptedTokens = {
	encryptedAccessToken: string;
	encryptedRefreshToken: string | null;
};

export const encryptTokens = (tokens: TokenResponse, encryptionKey: string): Promise<Result<EncryptedTokens, OAuthError>> =>
	pipe(encrypt(tokens.access_token, encryptionKey))
		.map_err((): OAuthError => ({ kind: "encryption_failed", message: "Failed to encrypt access token" }))
		.flat_map(async encryptedAccessToken => {
			const encryptedRefreshToken = tokens.refresh_token ? to_nullable(await encrypt(tokens.refresh_token, encryptionKey)) : null;
			return ok({ encryptedAccessToken, encryptedRefreshToken });
		})
		.result();

export const upsertOAuthAccount = (db: Database, encryptionKey: string, profileId: string, platform: Platform, user: OAuthUser, tokens: TokenResponse): Promise<Result<string, OAuthError>> =>
	pipe(encryptTokens(tokens, encryptionKey))
		.flat_map(async ({ encryptedAccessToken, encryptedRefreshToken }) => {
			const nowDate = new Date();
			const now = nowDate.toISOString();
			const tokenExpiresAt = calculateTokenExpiry(tokens.expires_in, nowDate);

			const existing = await db
				.select()
				.from(accounts)
				.where(and(eq(accounts.profile_id, profileId), eq(accounts.platform, platform), eq(accounts.platform_user_id, user.id)))
				.get();

			if (existing) {
				return updateExistingAccount(db, existing.id, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt, now);
			}

			return createNewAccount(db, profileId, platform, user, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt, now);
		})
		.result();

const updateExistingAccount = async (db: Database, accountId: string, encryptedAccessToken: string, encryptedRefreshToken: string | null, tokenExpiresAt: string | null, now: string): Promise<Result<string, OAuthError>> => {
	await db
		.update(accounts)
		.set({
			access_token_encrypted: encryptedAccessToken,
			refresh_token_encrypted: encryptedRefreshToken,
			token_expires_at: tokenExpiresAt,
			is_active: true,
			updated_at: now,
		})
		.where(eq(accounts.id, accountId));

	return ok(accountId);
};

const createNewAccount = async (
	db: Database,
	profileId: string,
	platform: Platform,
	user: OAuthUser,
	encryptedAccessToken: string,
	encryptedRefreshToken: string | null,
	tokenExpiresAt: string | null,
	now: string
): Promise<Result<string, OAuthError>> => {
	const accountId = uuid();

	await db.insert(accounts).values({
		id: accountId,
		profile_id: profileId,
		platform,
		platform_user_id: user.id,
		platform_username: user.username,
		access_token_encrypted: encryptedAccessToken,
		refresh_token_encrypted: encryptedRefreshToken,
		token_expires_at: tokenExpiresAt,
		is_active: true,
		created_at: now,
		updated_at: now,
	});

	return ok(accountId);
};

type OAuthCallbackError = OAuthError & { errorCode: string };

const toCallbackError = (error: OAuthError, errorCode: string): OAuthCallbackError => ({ ...error, errorCode });

export const createOAuthCallback = <TState extends Record<string, unknown> = Record<string, never>>(config: OAuthCallbackConfig<TState>) => {
	return async (c: HonoContext) => {
		const ctx = c.get("appContext");
		if (!ctx) throw new Error("AppContext not set");

		const validation = validateOAuthRequest(c, config);
		if (!validation.ok) return validation.error;

		const { code, stateData, redirectUri, clientId, clientSecret } = validation.value;

		const result = await pipe(exchangeCodeForTokens(code, redirectUri, clientId, clientSecret, config, stateData))
			.map_err(e => toCallbackError(e, "token_failed"))
			.tap_err(e => console.error(`[${config.platform}-oauth] Token exchange failed:`, e.message))
			.flat_map(tokens =>
				pipe(fetchOAuthUserProfile(tokens.access_token, config))
					.map_err(e => toCallbackError(e, "user_failed"))
					.map(user => ({ tokens, user }))
					.result()
			)
			.tap_err(e => console.error(`[${config.platform}-oauth] Failed to get user info:`, e.message))
			.flat_map(({ tokens, user }) =>
				pipe(upsertOAuthAccount(ctx.db, ctx.encryptionKey, stateData.profile_id, config.platform, user, tokens))
					.map_err(e => toCallbackError(e, "save_failed"))
					.result()
			)
			.tap_err(e => console.error(`[${config.platform}-oauth] Failed to save account:`, e.message))
			.result();

		return result.ok ? redirectWithSuccess(c, config.platform) : redirectWithError(c, config.platform, result.error.errorCode);
	};
};
