import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Bindings } from "./bindings";
import type { AppContext } from "./infrastructure";
import { apiKeys } from "./schema";
import { hashApiKey } from "./utils";

export type AuthContext = {
	user_id: string;
	key_id: string;
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

/**
 * Get auth context from request, throwing a clear error if middleware wasn't applied.
 * Use this instead of `c.get("auth")` to fail fast with actionable error messages.
 */
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

export const authMiddleware = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return c.json({ error: "Unauthorized", message: "Missing or invalid Authorization header" }, 401);
	}

	const apiKey = authHeader.slice(7);
	if (!apiKey) {
		return c.json({ error: "Unauthorized", message: "API key required" }, 401);
	}

	const ctx = getContext(c);
	const keyHash = await hashApiKey(apiKey);

	const result = await ctx.db.select({ id: apiKeys.id, user_id: apiKeys.user_id }).from(apiKeys).where(eq(apiKeys.key_hash, keyHash)).get();

	if (!result) {
		return c.json({ error: "Unauthorized", message: "Invalid API key" }, 401);
	}

	await ctx.db.update(apiKeys).set({ last_used_at: new Date().toISOString() }).where(eq(apiKeys.id, result.id));

	c.set("auth", {
		user_id: result.user_id,
		key_id: result.id,
	});

	await next();
});
