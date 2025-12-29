import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Bindings } from "./bindings";
import type { Database } from "./db";
import type { AppContext } from "./infrastructure";
import { type User, users } from "./schema";
import { type Result, ok, try_catch_async, uuid } from "./utils";

type DevpadUser = {
	id: string;
	name: string | null;
	email: string | null;
	github_id: number | null;
	image_url: string | null;
};

type VerifyResponse = { authenticated: true; user: DevpadUser } | { authenticated: false };

type AuthError = { kind: "auth_failed"; message: string };

type SyncError = { kind: "db_error"; message: string } | { kind: "user_not_found"; devpad_id: string };

const DEFAULT_DEVPAD_URL = "https://devpad.tools";

type VerifyOptions = {
	baseUrl?: string;
};

const verifyRequest = async (headers: HeadersInit, options: VerifyOptions = {}): Promise<Result<VerifyResponse, AuthError>> =>
	try_catch_async(
		async () => {
			const baseUrl = options.baseUrl ?? DEFAULT_DEVPAD_URL;
			const response = await fetch(`${baseUrl}/api/auth/verify`, {
				method: "GET",
				headers,
			});

			if (!response.ok) {
				return { authenticated: false } as VerifyResponse;
			}

			return (await response.json()) as VerifyResponse;
		},
		(e): AuthError => ({ kind: "auth_failed", message: String(e) })
	);

export const verifySessionCookie = async (cookie: string, options: VerifyOptions = {}): Promise<VerifyResponse> => {
	const result = await verifyRequest({ Cookie: cookie }, options);
	return result.ok ? result.value : { authenticated: false };
};

export const verifyApiKey = async (apiKey: string, options: VerifyOptions = {}): Promise<VerifyResponse> => {
	const result = await verifyRequest({ Authorization: `Bearer ${apiKey}` }, options);
	return result.ok ? result.value : { authenticated: false };
};

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
			db.update(users)
				.set({
					name: devpadUser.name,
					email: devpadUser.email,
					updated_at: now,
				})
				.where(eq(users.id, existing.id))
				.run();

			return { ...existing, name: devpadUser.name, email: devpadUser.email, updated_at: now };
		},
		(e): SyncError => ({ kind: "db_error", message: String(e) })
	);
};

export const syncDevpadUser = async (db: Database, devpadUser: DevpadUser): Promise<Result<User, SyncError>> => {
	const existing = await findByDevpadId(db, devpadUser.id);

	if (existing) return updateUserIfChanged(db, existing, devpadUser);

	return createUser(db, devpadUser);
};

export type DevpadAuthContext = {
	user_id: string;
	devpad_user_id: string;
};

type Variables = {
	devpadAuth: DevpadAuthContext;
	appContext: AppContext;
};

declare module "hono" {
	interface ContextVariableMap {
		devpadAuth: DevpadAuthContext;
	}
}

const getContext = (c: Context<{ Bindings: Bindings; Variables: Variables }>): AppContext => {
	const ctx = c.get("appContext");
	if (!ctx) {
		throw new Error("AppContext not set. Ensure context middleware runs before devpadAuthMiddleware.");
	}
	return ctx;
};

/**
 * Middleware for routes that require devpad authentication.
 * Checks session cookie first (for web UI), then API key header (for external API).
 *
 * On success, sets `devpadAuth` context with { user_id, devpad_user_id }.
 * On failure, returns 401 Unauthorized.
 */
export const devpadAuthMiddleware = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
	const ctx = getContext(c);

	const cookieHeader = c.req.header("Cookie");
	if (cookieHeader) {
		const result = await verifySessionCookie(cookieHeader);
		if (result.authenticated) {
			const syncResult = await syncDevpadUser(ctx.db, result.user);
			if (syncResult.ok) {
				c.set("devpadAuth", {
					user_id: syncResult.value.id,
					devpad_user_id: result.user.id,
				});
				return next();
			}
		}
	}

	const authHeader = c.req.header("Authorization");
	if (authHeader?.startsWith("Bearer ")) {
		const apiKey = authHeader.slice(7);
		const result = await verifyApiKey(apiKey);
		if (result.authenticated) {
			const syncResult = await syncDevpadUser(ctx.db, result.user);
			if (syncResult.ok) {
				c.set("devpadAuth", {
					user_id: syncResult.value.id,
					devpad_user_id: result.user.id,
				});
				return next();
			}
		}
	}

	return c.json({ error: "Unauthorized", message: "Valid session cookie or API key required" }, 401);
});

/**
 * Get devpad auth context from request, throwing a clear error if middleware wasn't applied.
 * Use this instead of `c.get("devpadAuth")` to fail fast with actionable error messages.
 */
export const getDevpadAuth = (c: Context): DevpadAuthContext => {
	const auth = c.get("devpadAuth");
	if (!auth) {
		throw new Error("DevpadAuth context not found. Ensure devpadAuthMiddleware is applied to this route. " + "Add `app.use('/api/*', devpadAuthMiddleware)` in index.ts");
	}
	return auth;
};

export type { DevpadUser, SyncError, VerifyOptions, VerifyResponse };
