import { hashApiKey } from "@media-timeline/core";
import { createMiddleware } from "hono/factory";
import type { Bindings } from "../bindings";

type AuthContext = {
	user_id: string;
	key_id: string;
};

declare module "hono" {
	interface ContextVariableMap {
		auth: AuthContext;
	}
}

type ApiKeyRow = {
	id: string;
	user_id: string;
};

export const authMiddleware = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return c.json({ error: "Unauthorized", message: "Missing or invalid Authorization header" }, 401);
	}

	const apiKey = authHeader.slice(7);
	if (!apiKey) {
		return c.json({ error: "Unauthorized", message: "API key required" }, 401);
	}

	const keyHash = await hashApiKey(apiKey);

	const result = await c.env.DB.prepare("SELECT id, user_id FROM api_keys WHERE key_hash = ?").bind(keyHash).first<ApiKeyRow>();

	if (!result) {
		return c.json({ error: "Unauthorized", message: "Invalid API key" }, 401);
	}

	await c.env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), result.id).run();

	c.set("auth", {
		user_id: result.user_id,
		key_id: result.id,
	});

	await next();
});
