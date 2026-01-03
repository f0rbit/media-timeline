import { type User, apiKeys, users } from "@media/schema";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Bindings } from "./bindings";
import type { Database } from "./db";
import type { AppContext } from "./infrastructure";
import { type FetchError, type Result, err, hash_api_key, ok, pipe, try_catch_async, uuid } from "./utils";

const JWT_PREFIX = "Bearer jwt:";
const DEFAULT_DEVPAD_URL = "https://devpad.tools";

type DevpadUser = {
	id: string;
	name: string | null;
	email: string | null;
	github_id: number | null;
	image_url: string | null;
};

type VerifyResponse = { authenticated: true; user: DevpadUser } | { authenticated: false };

type SyncError = { kind: "db_error"; message: string } | { kind: "user_not_found"; devpad_id: string };

type VerifyOptions = { baseUrl?: string };

export type AuthContext = {
	user_id: string;
	key_id?: string;
	devpad_user_id?: string;
	jwt_token?: string;
};

export type DevpadAuthContext = {
	user_id: string;
	devpad_user_id: string;
	jwt_token?: string;
};

type AuthVariables = {
	auth: AuthContext;
	appContext: AppContext;
};

type DevpadAuthVariables = {
	devpadAuth: DevpadAuthContext;
	appContext: AppContext;
};

declare module "hono" {
	interface ContextVariableMap {
		auth: AuthContext;
		devpadAuth: DevpadAuthContext;
	}
}

const extractJWTFromAuthHeader = (authHeader: string): string | null => {
	if (!authHeader.startsWith(JWT_PREFIX)) return null;
	const token = authHeader.slice(JWT_PREFIX.length);
	return token.length > 0 ? token : null;
};

const extractBearerToken = (authHeader: string): string | null => {
	if (!authHeader.startsWith("Bearer ") || authHeader.startsWith(JWT_PREFIX)) return null;
	const token = authHeader.slice(7);
	return token.length > 0 ? token : null;
};

const getDevpadUrl = (env: (Bindings & { DEVPAD_URL?: string }) | undefined): string => env?.DEVPAD_URL ?? DEFAULT_DEVPAD_URL;

const getContext = (c: Context): AppContext => {
	const ctx = c.get("appContext");
	if (!ctx) throw new Error("AppContext not set. Ensure context middleware runs before auth middleware.");
	return ctx;
};

const verifyRequest = (headers: HeadersInit, options: VerifyOptions = {}): Promise<VerifyResponse> => {
	const baseUrl = options.baseUrl ?? DEFAULT_DEVPAD_URL;
	return pipe.fetch<VerifyResponse, FetchError>(`${baseUrl}/api/auth/verify`, { method: "GET", headers }, e => e).unwrap_or({ authenticated: false });
};

export const verifySessionCookie = (cookie: string, options: VerifyOptions = {}): Promise<VerifyResponse> => verifyRequest({ Cookie: cookie }, options);

export const verifyApiKey = (apiKey: string, options: VerifyOptions = {}): Promise<VerifyResponse> => verifyRequest({ Authorization: `Bearer ${apiKey}` }, options);

export const verifyJWT = (jwt: string, options: VerifyOptions = {}): Promise<VerifyResponse> => verifyRequest({ Authorization: `Bearer jwt:${jwt}` }, options);

const findByDevpadId = async (db: Database, devpadId: string): Promise<User | undefined> => db.select().from(users).where(eq(users.devpad_user_id, devpadId)).get();

const createUser = async (db: Database, devpadUser: DevpadUser): Promise<Result<User, SyncError>> =>
	try_catch_async(
		async () => {
			const now = new Date().toISOString();
			const newUser = {
				id: uuid(),
				devpad_user_id: devpadUser.id,
				name: devpadUser.name,
				email: devpadUser.email,
				created_at: now,
				updated_at: now,
			};
			db.insert(users).values(newUser).run();
			return newUser as User;
		},
		(e): SyncError => ({ kind: "db_error", message: String(e) })
	);

const updateUserIfChanged = async (db: Database, existing: User, devpadUser: DevpadUser): Promise<Result<User, SyncError>> => {
	const hasChanges = existing.name !== devpadUser.name || existing.email !== devpadUser.email;
	if (!hasChanges) return ok(existing);

	return try_catch_async(
		async () => {
			const now = new Date().toISOString();
			db.update(users).set({ name: devpadUser.name, email: devpadUser.email, updated_at: now }).where(eq(users.id, existing.id)).run();
			return { ...existing, name: devpadUser.name, email: devpadUser.email, updated_at: now };
		},
		(e): SyncError => ({ kind: "db_error", message: String(e) })
	);
};

export const syncDevpadUser = async (db: Database, devpadUser: DevpadUser): Promise<Result<User, SyncError>> => {
	const existing = await findByDevpadId(db, devpadUser.id);
	return existing ? updateUserIfChanged(db, existing, devpadUser) : createUser(db, devpadUser);
};

const validateApiKey = async (db: Database, token: string): Promise<Result<AuthContext, { kind: "invalid_api_key"; message: string }>> => {
	const keyHash = await hash_api_key(token);
	const result = await db.select({ id: apiKeys.id, user_id: apiKeys.user_id }).from(apiKeys).where(eq(apiKeys.key_hash, keyHash)).get();
	if (!result) return err({ kind: "invalid_api_key", message: "Invalid API key" });

	await db.update(apiKeys).set({ last_used_at: new Date().toISOString() }).where(eq(apiKeys.id, result.id));
	return ok({ user_id: result.user_id, key_id: result.id });
};

export const getAuth = (c: Context): AuthContext => {
	const auth = c.get("auth");
	if (!auth) {
		throw new Error("Auth context not found. Ensure authMiddleware is applied to this route. Add `app.use('/api/*', authMiddleware)` in index.ts");
	}
	return auth;
};

export const getDevpadAuth = (c: Context): DevpadAuthContext => {
	const auth = c.get("devpadAuth");
	if (!auth) {
		throw new Error("DevpadAuth context not found. Ensure devpadAuthMiddleware is applied to this route. Add `app.use('/api/*', devpadAuthMiddleware)` in index.ts");
	}
	return auth;
};

export const authMiddleware = createMiddleware<{ Bindings: Bindings; Variables: AuthVariables }>(async (c, next) => {
	const ctx = getContext(c);
	const devpadUrl = getDevpadUrl(c.env as Bindings & { DEVPAD_URL?: string });
	const options = { baseUrl: devpadUrl };

	const authHeader = c.req.header("Authorization");
	if (authHeader) {
		const bearerToken = extractBearerToken(authHeader);
		if (bearerToken) {
			const result = await validateApiKey(ctx.db, bearerToken);
			if (result.ok) {
				c.set("auth", result.value);
				return next();
			}
		}

		const jwtFromAuth = extractJWTFromAuthHeader(authHeader);
		if (jwtFromAuth) {
			const result = await verifyJWT(jwtFromAuth, options);
			if (result.authenticated) {
				const syncResult = await syncDevpadUser(ctx.db, result.user);
				if (syncResult.ok) {
					c.set("auth", { user_id: syncResult.value.id, devpad_user_id: result.user.id, jwt_token: jwtFromAuth });
					return next();
				}
			}
		}
	}

	const authToken = c.req.header("Auth-Token");
	if (authToken) {
		const result = await verifyJWT(authToken, options);
		if (result.authenticated) {
			const syncResult = await syncDevpadUser(ctx.db, result.user);
			if (syncResult.ok) {
				c.set("auth", { user_id: syncResult.value.id, devpad_user_id: result.user.id, jwt_token: authToken });
				return next();
			}
		}
	}

	const jwtCookie = getCookie(c, "devpad_jwt");
	if (jwtCookie) {
		const result = await verifyJWT(jwtCookie, options);
		if (result.authenticated) {
			const syncResult = await syncDevpadUser(ctx.db, result.user);
			if (syncResult.ok) {
				c.set("auth", { user_id: syncResult.value.id, devpad_user_id: result.user.id, jwt_token: jwtCookie });
				return next();
			}
		}
	}

	const cookieHeader = c.req.header("Cookie");
	if (cookieHeader) {
		const result = await verifySessionCookie(cookieHeader, options);
		if (result.authenticated) {
			const syncResult = await syncDevpadUser(ctx.db, result.user);
			if (syncResult.ok) {
				c.set("auth", { user_id: syncResult.value.id, devpad_user_id: result.user.id });
				return next();
			}
		}
	}

	return c.json({ error: "Unauthorized", message: "Authentication required" }, 401);
});

/**
 * Middleware for routes that require devpad authentication.
 * Checks in order:
 * 1. Auth-Token header (JWT)
 * 2. Authorization: Bearer jwt:... header (JWT)
 * 3. devpad_jwt cookie (JWT)
 * 4. Full Cookie header (session cookie)
 * 5. Authorization: Bearer <api-key> (DevPad API key)
 *
 * On success, sets `devpadAuth` context with { user_id, devpad_user_id, jwt_token? }.
 * On failure, returns 401 Unauthorized.
 */
export const devpadAuthMiddleware = createMiddleware<{ Bindings: Bindings; Variables: DevpadAuthVariables }>(async (c, next) => {
	const ctx = getContext(c);
	const devpadUrl = getDevpadUrl(c.env as Bindings & { DEVPAD_URL?: string });
	const options = { baseUrl: devpadUrl };

	const authToken = c.req.header("Auth-Token");
	if (authToken) {
		const result = await verifyJWT(authToken, options);
		if (result.authenticated) {
			const syncResult = await syncDevpadUser(ctx.db, result.user);
			if (syncResult.ok) {
				c.set("devpadAuth", { user_id: syncResult.value.id, devpad_user_id: result.user.id, jwt_token: authToken });
				return next();
			}
		}
	}

	const authHeader = c.req.header("Authorization");
	if (authHeader) {
		const jwtFromAuth = extractJWTFromAuthHeader(authHeader);
		if (jwtFromAuth) {
			const result = await verifyJWT(jwtFromAuth, options);
			if (result.authenticated) {
				const syncResult = await syncDevpadUser(ctx.db, result.user);
				if (syncResult.ok) {
					c.set("devpadAuth", { user_id: syncResult.value.id, devpad_user_id: result.user.id, jwt_token: jwtFromAuth });
					return next();
				}
			}
		}
	}

	const jwtCookie = getCookie(c, "devpad_jwt");
	if (jwtCookie) {
		const result = await verifyJWT(jwtCookie, options);
		if (result.authenticated) {
			const syncResult = await syncDevpadUser(ctx.db, result.user);
			if (syncResult.ok) {
				c.set("devpadAuth", { user_id: syncResult.value.id, devpad_user_id: result.user.id, jwt_token: jwtCookie });
				return next();
			}
		}
	}

	const cookieHeader = c.req.header("Cookie");
	if (cookieHeader) {
		const result = await verifySessionCookie(cookieHeader, options);
		if (result.authenticated) {
			const syncResult = await syncDevpadUser(ctx.db, result.user);
			if (syncResult.ok) {
				c.set("devpadAuth", { user_id: syncResult.value.id, devpad_user_id: result.user.id });
				return next();
			}
		}
	}

	if (authHeader) {
		const apiKey = extractBearerToken(authHeader);
		if (apiKey) {
			const result = await verifyApiKey(apiKey, options);
			if (result.authenticated) {
				const syncResult = await syncDevpadUser(ctx.db, result.user);
				if (syncResult.ok) {
					c.set("devpadAuth", { user_id: syncResult.value.id, devpad_user_id: result.user.id });
					return next();
				}
			}
		}
	}

	return c.json({ error: "Unauthorized", message: "Valid session cookie or API key required" }, 401);
});

export type { DevpadUser, SyncError, VerifyOptions, VerifyResponse };
