import { type User, users } from "@media/schema";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Bindings } from "./bindings";
import type { Database } from "./db";
import type { AppContext } from "./infrastructure";
import { type FetchError, type Result, ok, pipe, try_catch_async, uuid } from "./utils";

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
	devpad_user_id: string;
	jwt_token?: string;
};

type AuthVariables = {
	auth: AuthContext;
	appContext: AppContext;
};

declare module "hono" {
	interface ContextVariableMap {
		auth: AuthContext;
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

export const getAuth = (c: Context): AuthContext => {
	const auth = c.get("auth");
	if (!auth) {
		throw new Error("Auth context not found. Ensure authMiddleware is applied to this route. Add `app.use('/api/*', authMiddleware)` in index.ts");
	}
	return auth;
};

export const authMiddleware = createMiddleware<{ Bindings: Bindings; Variables: AuthVariables }>(async (c, next) => {
	const ctx = getContext(c);
	const devpadUrl = getDevpadUrl(c.env as Bindings & { DEVPAD_URL?: string });
	const options = { baseUrl: devpadUrl };

	// 1. Try Auth-Token header (JWT) - preferred method
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

	// 2. Try Authorization: Bearer jwt:<token>
	const authHeader = c.req.header("Authorization");
	if (authHeader) {
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

	// 3. Try devpad_jwt cookie
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

	// 4. Try session cookie
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

	// 5. Try DevPad API key (remote verification)
	if (authHeader) {
		const apiKey = extractBearerToken(authHeader);
		if (apiKey) {
			const result = await verifyApiKey(apiKey, options);
			if (result.authenticated) {
				const syncResult = await syncDevpadUser(ctx.db, result.user);
				if (syncResult.ok) {
					c.set("auth", { user_id: syncResult.value.id, devpad_user_id: result.user.id });
					return next();
				}
			}
		}
	}

	return c.json({ error: "Unauthorized", message: "Authentication required" }, 401);
});

export type { DevpadUser, SyncError, VerifyOptions, VerifyResponse };
