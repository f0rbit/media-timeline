/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./auth";
import { type Bindings, createContextFromBindings } from "./bindings";
import { handleCron } from "./cron";
import type { AppContext } from "./infrastructure";
import { defaultProviderFactory } from "./platforms";
import { authRoutes, connectionRoutes, timelineRoutes } from "./routes";

type Variables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use(
	"*",
	cors({
		origin: origin => {
			const allowed = ["http://localhost:4321", "http://localhost:3000", "https://media.devpad.tools"];
			if (!origin || allowed.includes(origin)) return origin;
			if (origin.endsWith(".workers.dev")) return origin;
			return null;
		},
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	})
);

app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// Global request logging
app.use("*", async (c, next) => {
	console.log(`[REQUEST] ${c.req.method} ${c.req.path}`);
	console.log(`[REQUEST] Full URL: ${c.req.url}`);
	console.log(`[REQUEST] Headers:`, Object.fromEntries(c.req.raw.headers.entries()));
	await next();
});

// Context middleware for all API routes
app.use("/api/*", async (c, next) => {
	console.log(`[CONTEXT MW] Path: ${c.req.path}`);
	const ctx = createContextFromBindings(c.env, defaultProviderFactory);
	c.set("appContext", ctx);
	await next();
});

// Auth middleware - skip for /api/auth/* (OAuth routes handle their own auth)
app.use("/api/*", async (c, next) => {
	console.log(`[AUTH MW] Path: ${c.req.path}`);
	console.log(`[AUTH MW] Checking if starts with /api/auth: ${c.req.path.startsWith("/api/auth")}`);
	if (c.req.path.startsWith("/api/auth")) {
		console.log(`[AUTH MW] SKIPPING auth for OAuth route`);
		return next();
	}
	console.log(`[AUTH MW] APPLYING auth middleware`);
	return authMiddleware(c, next);
});

// Routes
console.log("[SETUP] Registering /api/auth routes");
app.route("/api/auth", authRoutes);
console.log("[SETUP] Registering /api/v1/timeline routes");
app.route("/api/v1/timeline", timelineRoutes);
console.log("[SETUP] Registering /api/v1/connections routes");
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
