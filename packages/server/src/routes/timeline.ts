import { Hono } from "hono";
import { type AuthContext, getAuth } from "../auth";
import type { Bindings } from "../bindings";
import { badRequest, forbidden } from "../http-errors";
import type { AppContext } from "../infrastructure";
import { getRawPlatformData, getTimeline } from "../services/timeline";
import { getContext, handleResult } from "../utils/route-helpers";

type Variables = {
	auth: AuthContext;
	appContext: AppContext;
};

export const timelineRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

timelineRoutes.get("/:user_id", async c => {
	const userId = c.req.param("user_id");
	const auth = getAuth(c);
	const ctx = getContext(c);

	if (auth.user_id !== userId) {
		return forbidden(c, "Cannot access other user timelines");
	}

	const from = c.req.query("from");
	const to = c.req.query("to");

	const result = await getTimeline(ctx, userId, { from, to });
	return handleResult(c, result);
});

timelineRoutes.get("/:user_id/raw/:platform", async c => {
	const userId = c.req.param("user_id");
	const platform = c.req.param("platform");
	const auth = getAuth(c);
	const ctx = getContext(c);

	if (auth.user_id !== userId) {
		return forbidden(c, "Cannot access other user data");
	}

	const accountId = c.req.query("account_id");
	if (!accountId) {
		return badRequest(c, "account_id query parameter required");
	}

	const result = await getRawPlatformData(ctx, userId, platform, accountId);
	return handleResult(c, result);
});
