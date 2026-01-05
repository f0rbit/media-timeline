import * as schema from "@media/schema/database";
import { connectionRoutes, profileRoutes, timelineRoutes } from "@media/server";
import type { AppContext } from "@media/server/infrastructure";
import { credentialRoutes } from "@media/server/routes";
import { hash_api_key } from "@media/server/utils";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { TestContext } from "./types";

type TestVariables = {
	auth: { user_id: string; name: string | null; email: string | null; image_url: string | null; jwt_token?: string };
	appContext: AppContext;
};

const createTestAuthMiddleware = (ctx: TestContext) => {
	return async (c: { req: { header: (name: string) => string | undefined }; set: (key: string, value: unknown) => void; json: (body: unknown, status?: number) => Response }, next: () => Promise<void>) => {
		const authHeader = c.req.header("Authorization");
		if (authHeader?.startsWith("Bearer ")) {
			const token = authHeader.slice(7);
			const keyHash = await hash_api_key(token);

			const result = await ctx.drizzle
				.select({
					id: schema.apiKeys.id,
					user_id: schema.apiKeys.user_id,
					name: schema.users.name,
					email: schema.users.email,
				})
				.from(schema.apiKeys)
				.innerJoin(schema.users, sql`${schema.apiKeys.user_id} = ${schema.users.id}`)
				.where(sql`${schema.apiKeys.key_hash} = ${keyHash}`)
				.get();

			if (result) {
				c.set("auth", {
					user_id: result.user_id,
					name: result.name ?? null,
					email: result.email ?? null,
					image_url: null,
				});
				return next();
			}
		}
		return c.json({ error: "Unauthorized", message: "Authentication required" }, 401);
	};
};

export const createTestApp = (ctx: TestContext) => {
	const app = new Hono<{ Variables: TestVariables }>();

	app.get("/health", c => c.json({ status: "ok", timestamp: new Date().toISOString() }));

	const mediaApp = new Hono<{ Variables: TestVariables }>();

	mediaApp.use("/api/*", async (c, next) => {
		c.set("appContext", ctx.appContext);
		await next();
	});

	mediaApp.use("/api/*", createTestAuthMiddleware(ctx));

	mediaApp.route("/api/v1/timeline", timelineRoutes);
	mediaApp.route("/api/v1/connections", connectionRoutes);
	mediaApp.route("/api/v1/profiles", profileRoutes);
	mediaApp.route("/api/v1/credentials", credentialRoutes);

	app.route("/media", mediaApp);

	app.notFound(c => c.json({ error: "Not found", path: c.req.path }, 404));

	return app;
};
