/// <reference types="@cloudflare/workers-types" />

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware, getAuth } from "./auth";
import { type Bindings, createContextFromBindings } from "./bindings";
import { handleCron } from "./cron";
import type { AppContext } from "./infrastructure";
import { defaultProviderFactory } from "./platforms";
import { authRoutes, connectionRoutes, profileRoutes, timelineRoutes } from "./routes";
import { users } from "./schema";

type Variables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use(
	"*",
	cors({
		origin: origin => {
			const allowed = ["http://localhost:4321", "http://localhost:3000", "https://media.devpad.tools", "https://devpad.tools"];
			if (!origin || allowed.includes(origin)) return origin;
			if (origin.endsWith(".workers.dev")) return origin;
			return null;
		},
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	})
);

app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

const mediaApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();

mediaApp.use("/api/*", async (c, next) => {
	const ctx = createContextFromBindings(c.env, defaultProviderFactory);
	c.set("appContext", ctx);
	await next();
});

mediaApp.use("/api/*", async (c, next) => {
	if (c.req.path.startsWith("/media/api/auth")) {
		return next();
	}
	return authMiddleware(c, next);
});

mediaApp.route("/api/auth", authRoutes);
mediaApp.route("/api/v1/timeline", timelineRoutes);
mediaApp.route("/api/v1/connections", connectionRoutes);
mediaApp.route("/api/v1/profiles", profileRoutes);

mediaApp.get("/api/v1/me", async c => {
	const auth = getAuth(c);
	const ctx = c.get("appContext");

	const user = await ctx.db.select().from(users).where(eq(users.id, auth.user_id)).get();

	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}

	return c.json({
		id: user.id,
		name: user.name,
		email: user.email,
	});
});

mediaApp.post("/api/auth/logout", c => {
	return c.json({ redirect: "https://devpad.tools/logout" });
});

app.route("/media", mediaApp);

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
