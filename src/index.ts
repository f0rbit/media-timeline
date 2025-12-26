/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./auth";
import { createContextFromBindings, type Bindings } from "./bindings";
import { handleCron } from "./cron";
import type { AppContext } from "./infrastructure";
import { defaultProviderFactory } from "./platforms";
import { connectionRoutes, timelineRoutes } from "./routes";

type Variables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use(
	"*",
	cors({
		origin: ["http://localhost:4321", "http://localhost:3000", "https://media.devpad.tools"],
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	})
);

app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

app.use("/api/*", async (c, next) => {
	const ctx = createContextFromBindings(c.env, defaultProviderFactory);
	c.set("appContext", ctx);
	await next();
});

app.use("/api/*", authMiddleware);
app.route("/api/v1/timeline", timelineRoutes);
app.route("/api/v1/connections", connectionRoutes);

app.notFound(c => c.json({ error: "Not found", path: c.req.path }, 404));

app.onError((err, c) => {
	console.error("Unhandled error:", err);
	return c.json({ error: "Internal server error", message: err.message }, 500);
});

export default {
	fetch: app.fetch,
	async scheduled(_event: ScheduledEvent, env: Bindings, executionCtx: ExecutionContext) {
		const appCtx = createContextFromBindings(env, defaultProviderFactory);
		executionCtx.waitUntil(handleCron(appCtx));
	},
};
