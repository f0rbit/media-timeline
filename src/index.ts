/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./auth";
import type { Bindings } from "./bindings";
import { handleCron } from "./cron";
import { connectionRoutes, timelineRoutes } from "./routes";

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", cors());

app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

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
	async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
		ctx.waitUntil(handleCron(env));
	},
};
