import { apiKeys, users } from "@media/schema";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import type { Bindings } from "./bindings";
import type { Database } from "./db";
import type { AppContext } from "./infrastructure";
import { type Result, err, hash_api_key, ok, pipe, try_catch_async, uuid } from "./utils";

const JWT_PREFIX = "Bearer jwt:";
const DEFAULT_DEVPAD_URL = "https://devpad.tools";

const DevpadVerifyResponseSchema = z.object({
	authenticated: z.boolean(),
	user: z
		.object({
			id: z.string(),
			name: z.string().nullable(),
			email: z.string().nullable().optional(),
			github_id: z.number().nullable().optional(),
			image_url: z.string().nullable().optional(),
		})
		.nullable(),
});

type DevpadUser = {
	id: string;
	name: string | null;
	email: string | null;
	github_id: number | null;
	image_url: string | null;
};

type AuthError =
	| { kind: "missing_auth"; message: string }
	| { kind: "invalid_api_key"; message: string }
	| { kind: "invalid_jwt"; message: string }
	| { kind: "invalid_session"; message: string }
	| { kind: "user_sync_failed"; message: string };

export type AuthContext = {
	user_id: string;
	key_id?: string;
	devpad_user_id?: string;
	jwt_token?: string;
};

type Variables = {
	auth: AuthContext;
	appContext: AppContext;
};

declare module "hono" {
	interface ContextVariableMap {
		auth: AuthContext;
	}
}

export const getAuth = (c: Context): AuthContext => {
	const auth = c.get("auth");
	if (!auth) {
		throw new Error("Auth context not found. Ensure authMiddleware is applied to this route. " + "Add `app.use('/api/*', authMiddleware)` in index.ts");
	}
	return auth;
};

const getContext = (c: Context<{ Bindings: Bindings; Variables: Variables }>): AppContext => {
	const ctx = c.get("appContext");
	if (!ctx) {
		throw new Error("AppContext not set. Ensure context middleware runs before authMiddleware.");
	}
	return ctx;
};

const validateApiKey = async (db: Database, token: string): Promise<Result<AuthContext, AuthError>> => {
	const keyHash = await hash_api_key(token);

	const result = await db.select({ id: apiKeys.id, user_id: apiKeys.user_id }).from(apiKeys).where(eq(apiKeys.key_hash, keyHash)).get();

	if (!result) return err({ kind: "invalid_api_key", message: "Invalid API key" });

	await db.update(apiKeys).set({ last_used_at: new Date().toISOString() }).where(eq(apiKeys.id, result.id));

	return ok({
		user_id: result.user_id,
		key_id: result.id,
	});
};

const verifyWithDevpadJWT = async (devpadUrl: string, jwtToken: string): Promise<Result<DevpadUser, AuthError>> => {
	const fetchResult = await try_catch_async(
		async () => {
			const response = await fetch(`${devpadUrl}/api/auth/verify`, {
				method: "GET",
				headers: { Authorization: `Bearer jwt:${jwtToken}` },
			});
			if (!response.ok) throw new Error("jwt_invalid");
			return response.json();
		},
		(): AuthError => ({ kind: "invalid_jwt", message: "JWT verification failed" })
	);

	return pipe(fetchResult)
		.flat_map((json: unknown): Result<DevpadUser, AuthError> => {
			const parsed = DevpadVerifyResponseSchema.safeParse(json);
			if (!parsed.success) return err({ kind: "invalid_jwt", message: "Invalid response from DevPad" });
			if (!parsed.data.authenticated || !parsed.data.user) return err({ kind: "invalid_jwt", message: "Not authenticated" });

			const devpadUser = parsed.data.user;
			return ok({
				id: devpadUser.id,
				name: devpadUser.name,
				email: devpadUser.email ?? null,
				github_id: devpadUser.github_id ?? null,
				image_url: devpadUser.image_url ?? null,
			});
		})
		.result();
};

const verifyWithDevpadCookie = async (devpadUrl: string, cookie: string): Promise<Result<DevpadUser, AuthError>> => {
	const fetchResult = await try_catch_async(
		async () => {
			const response = await fetch(`${devpadUrl}/api/auth/verify`, {
				method: "GET",
				headers: { Cookie: cookie },
			});
			if (!response.ok) throw new Error("session_invalid");
			return response.json();
		},
		(): AuthError => ({ kind: "invalid_session", message: "Session verification failed" })
	);

	return pipe(fetchResult)
		.flat_map((json: unknown): Result<DevpadUser, AuthError> => {
			const parsed = DevpadVerifyResponseSchema.safeParse(json);
			if (!parsed.success) return err({ kind: "invalid_session", message: "Invalid response from DevPad" });
			if (!parsed.data.authenticated || !parsed.data.user) return err({ kind: "invalid_session", message: "Session invalid" });

			const devpadUser = parsed.data.user;
			return ok({
				id: devpadUser.id,
				name: devpadUser.name,
				email: devpadUser.email ?? null,
				github_id: devpadUser.github_id ?? null,
				image_url: devpadUser.image_url ?? null,
			});
		})
		.result();
};

const upsertUser = async (db: Database, devpadUser: DevpadUser): Promise<Result<string, AuthError>> =>
	try_catch_async(
		async () => {
			const existing = await db.select().from(users).where(eq(users.devpad_user_id, devpadUser.id)).get();

			if (existing) {
				const hasChanges = existing.name !== devpadUser.name || existing.email !== devpadUser.email;
				if (hasChanges) {
					await db
						.update(users)
						.set({
							name: devpadUser.name,
							email: devpadUser.email,
							updated_at: new Date().toISOString(),
						})
						.where(eq(users.id, existing.id));
				}
				return existing.id;
			}

			const now = new Date().toISOString();
			const newUser = {
				id: uuid(),
				devpad_user_id: devpadUser.id,
				name: devpadUser.name,
				email: devpadUser.email,
				created_at: now,
				updated_at: now,
			};
			await db.insert(users).values(newUser);
			return newUser.id;
		},
		(e): AuthError => ({ kind: "user_sync_failed", message: String(e) })
	);

const authenticateWithDevpadJWT = async (db: Database, devpadUrl: string, jwtToken: string): Promise<Result<AuthContext, AuthError>> =>
	pipe(verifyWithDevpadJWT(devpadUrl, jwtToken))
		.flat_map(devpadUser =>
			pipe(upsertUser(db, devpadUser))
				.map(
					(user_id): AuthContext => ({
						user_id,
						devpad_user_id: devpadUser.id,
						jwt_token: jwtToken,
					})
				)
				.result()
		)
		.result();

const authenticateWithDevpadCookie = async (db: Database, devpadUrl: string, cookie: string): Promise<Result<AuthContext, AuthError>> =>
	pipe(verifyWithDevpadCookie(devpadUrl, cookie))
		.flat_map(devpadUser =>
			pipe(upsertUser(db, devpadUser))
				.map(
					(user_id): AuthContext => ({
						user_id,
						devpad_user_id: devpadUser.id,
					})
				)
				.result()
		)
		.result();

const extractJWTFromAuthHeader = (authHeader: string): string | null => {
	if (authHeader.startsWith(JWT_PREFIX)) {
		const token = authHeader.slice(JWT_PREFIX.length);
		return token.length > 0 ? token : null;
	}
	return null;
};

const extractBearerToken = (authHeader: string): string | null => {
	if (authHeader.startsWith("Bearer ") && !authHeader.startsWith(JWT_PREFIX)) {
		const token = authHeader.slice(7);
		return token.length > 0 ? token : null;
	}
	return null;
};

const getDevpadUrl = (env: (Bindings & { DEVPAD_URL?: string }) | undefined): string => env?.DEVPAD_URL ?? DEFAULT_DEVPAD_URL;

export const authMiddleware = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
	const ctx = getContext(c);
	const devpadUrl = getDevpadUrl(c.env as Bindings & { DEVPAD_URL?: string });

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
			const result = await authenticateWithDevpadJWT(ctx.db, devpadUrl, jwtFromAuth);
			if (result.ok) {
				c.set("auth", result.value);
				return next();
			}
		}
	}

	const authToken = c.req.header("Auth-Token");
	if (authToken) {
		const result = await authenticateWithDevpadJWT(ctx.db, devpadUrl, authToken);
		if (result.ok) {
			c.set("auth", result.value);
			return next();
		}
	}

	const jwtCookie = getCookie(c, "devpad_jwt");
	if (jwtCookie) {
		const result = await authenticateWithDevpadJWT(ctx.db, devpadUrl, jwtCookie);
		if (result.ok) {
			c.set("auth", result.value);
			return next();
		}
	}

	const cookieHeader = c.req.header("Cookie");
	if (cookieHeader) {
		const result = await authenticateWithDevpadCookie(ctx.db, devpadUrl, cookieHeader);
		if (result.ok) {
			c.set("auth", result.value);
			return next();
		}
	}

	return c.json({ error: "Unauthorized", message: "Authentication required" }, 401);
});
