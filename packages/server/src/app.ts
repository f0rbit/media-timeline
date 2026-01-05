import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AuthContext, authMiddleware, getAuth, optionalAuthMiddleware } from "./auth";
import { type Bindings, createContextFromBindings } from "./bindings";
import type { AppContext } from "./infrastructure";
import { requestContextMiddleware } from "./middleware/request-context";
import { defaultProviderFactory } from "./platforms";
import type { ProviderFactory } from "./platforms/types";
import { authRoutes, connectionRoutes, credentialRoutes, profileRoutes, timelineRoutes } from "./routes/index";

type Variables = {
	auth: AuthContext;
	appContext: AppContext;
};

export type ApiAppConfig = {
	basePath?: string;
	corsOrigins?: string[];
	providerFactory?: ProviderFactory;
};

export function createApiApp(env: Bindings, config: ApiAppConfig = {}) {
	const { basePath = "/media", corsOrigins, providerFactory = defaultProviderFactory } = config;

	const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

	app.use("*", requestContextMiddleware());

	app.use(
		"*",
		cors({
			origin: origin => {
				const defaultOrigins = ["http://localhost:4321", "http://localhost:3000", "https://media.devpad.tools", "https://devpad.tools"];
				const allowed = corsOrigins ?? defaultOrigins;
				if (!origin || allowed.includes(origin)) return origin;
				if (origin.endsWith(".workers.dev") || origin.endsWith(".pages.dev")) return origin;
				return null;
			},
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization", "Auth-Token"],
			credentials: true,
		})
	);

	app.use("/api/*", async (c, next) => {
		const ctx = createContextFromBindings(env, providerFactory);
		c.set("appContext", ctx);
		await next();
	});

	app.use("/api/*", async (c, next) => {
		// Skip auth completely for login/callback/logout routes
		if (c.req.path.startsWith("/api/auth/login") || c.req.path.startsWith("/api/auth/callback") || c.req.path.startsWith("/api/auth/logout")) {
			return next();
		}
		// For OAuth platform routes (reddit, twitter, github), use optional auth
		// These routes handle their own auth validation via API key or cookie
		if (c.req.path.match(/^\/api\/auth\/(reddit|twitter|github)/)) {
			return optionalAuthMiddleware(c, next);
		}
		return authMiddleware(c, next);
	});

	app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

	app.route("/api/auth", authRoutes);
	app.route("/api/v1/timeline", timelineRoutes);
	app.route("/api/v1/connections", connectionRoutes);
	app.route("/api/v1/credentials", credentialRoutes);
	app.route("/api/v1/profiles", profileRoutes);

	app.get("/api/v1/me", c => {
		const auth = getAuth(c);
		return c.json({
			id: auth.user_id,
			name: auth.name,
			email: auth.email,
			image_url: auth.image_url,
		});
	});

	app.post("/api/auth/logout", c => {
		return c.json({ redirect: "https://devpad.tools/logout" });
	});

	return app;
}

export type { Bindings as MediaBindings } from "./bindings";
export type { AppContext } from "./infrastructure";
export type { ProviderFactory } from "./platforms/types";
