import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { Bindings } from "./bindings";
import type { Database } from "./db";
import type { AppContext } from "./infrastructure";
import { accountMembers, accounts, apiKeys } from "./schema";
import { type Result, encrypt, err, hash_api_key, ok, pipe, to_nullable, try_catch_async } from "./utils";

type Variables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

type HonoContext = Context<{ Bindings: Bindings; Variables: Variables }>;

export type Platform = "reddit" | "twitter" | "github";

export type OAuthStateBase = { user_id: string; nonce: string };
export type OAuthState<T extends Record<string, unknown> = Record<string, never>> = OAuthStateBase & T;

export type TokenResponse = {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	token_type: string;
	scope: string;
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

export const getFrontendUrl = (c: HonoContext): string => {
	// biome-ignore lint: env access
	return (c.env as any).FRONTEND_URL || "http://localhost:4321";
};

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

export const redirectWithError = (c: HonoContext, platform: Platform, errorCode: string): Response => c.redirect(`${getFrontendUrl(c)}/connections?error=${platform}_${errorCode}`);

export const redirectWithSuccess = (c: HonoContext, platform: Platform): Response => c.redirect(`${getFrontendUrl(c)}/connections?success=${platform}`);

export const encodeOAuthState = <T extends Record<string, unknown>>(userId: string, extra?: T): string => {
	const stateData: OAuthState<T> = {
		user_id: userId,
		nonce: crypto.randomUUID(),
		...(extra as T),
	};
	return btoa(JSON.stringify(stateData));
};

export const decodeOAuthState = <T extends Record<string, unknown> = Record<string, never>>(c: HonoContext, state: string | undefined, platform: Platform, requiredKeys: (keyof T)[] = []): Result<OAuthState<T>, Response> => {
	if (!state) {
		return err(redirectWithError(c, platform, "no_state"));
	}

	try {
		const stateData = JSON.parse(atob(state)) as OAuthState<T>;
		if (!stateData.user_id) throw new Error("No user_id in state");
		for (const key of requiredKeys) {
			if (!stateData[key]) throw new Error(`Missing ${String(key)} in state`);
		}
		return ok(stateData);
	} catch {
		console.error(`[${platform}-oauth] Invalid state parameter`);
		return err(redirectWithError(c, platform, "invalid_state"));
	}
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
	const redirectUri = `${c.env.APP_URL || "http://localhost:8787"}/api/auth/${config.platform}/callback`;

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

export const upsertOAuthAccount = (db: Database, encryptionKey: string, userId: string, platform: Platform, user: OAuthUser, tokens: TokenResponse): Promise<Result<string, OAuthError>> =>
	pipe(encryptTokens(tokens, encryptionKey))
		.flat_map(async ({ encryptedAccessToken, encryptedRefreshToken }) => {
			const now = new Date().toISOString();
			const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

			const existing = await db
				.select()
				.from(accounts)
				.where(and(eq(accounts.platform, platform), eq(accounts.platform_user_id, user.id)))
				.get();

			if (existing) {
				return updateExistingAccount(db, existing.id, userId, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt, now);
			}

			return createNewAccount(db, userId, platform, user, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt, now);
		})
		.result();

const updateExistingAccount = async (db: Database, accountId: string, userId: string, encryptedAccessToken: string, encryptedRefreshToken: string | null, tokenExpiresAt: string, now: string): Promise<Result<string, OAuthError>> => {
	const existingMembership = await db
		.select()
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, userId), eq(accountMembers.account_id, accountId)))
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
		.where(eq(accounts.id, accountId));

	if (!existingMembership) {
		await db.insert(accountMembers).values({
			id: crypto.randomUUID(),
			user_id: userId,
			account_id: accountId,
			role: "member",
			created_at: now,
		});
	}

	return ok(accountId);
};

const createNewAccount = async (
	db: Database,
	userId: string,
	platform: Platform,
	user: OAuthUser,
	encryptedAccessToken: string,
	encryptedRefreshToken: string | null,
	tokenExpiresAt: string,
	now: string
): Promise<Result<string, OAuthError>> => {
	const accountId = crypto.randomUUID();
	const memberId = crypto.randomUUID();

	await db.batch([
		db.insert(accounts).values({
			id: accountId,
			platform,
			platform_user_id: user.id,
			platform_username: user.username,
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
				pipe(upsertOAuthAccount(ctx.db, ctx.encryptionKey, stateData.user_id, config.platform, user, tokens))
					.map_err(e => toCallbackError(e, "save_failed"))
					.result()
			)
			.tap_err(e => console.error(`[${config.platform}-oauth] Failed to save account:`, e.message))
			.result();

		return result.ok ? redirectWithSuccess(c, config.platform) : redirectWithError(c, config.platform, result.error.errorCode);
	};
};
