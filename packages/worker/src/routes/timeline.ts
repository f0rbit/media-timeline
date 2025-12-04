import { Hono } from "hono";
import type { Bindings } from "../bindings";
import { createRawStore, createTimelineStore } from "../corpus";
import { authMiddleware } from "../middleware/auth";

type TimelineData = {
	groups: Array<{ date: string; items: unknown[] }>;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", authMiddleware);

app.get("/:user_id", async c => {
	const userId = c.req.param("user_id");
	const auth = c.get("auth");

	if (auth.user_id !== userId) {
		return c.json({ error: "Forbidden", message: "Cannot access other user timelines" }, 403);
	}

	const from = c.req.query("from");
	const to = c.req.query("to");

	const { store } = createTimelineStore(userId, c.env);
	const result = await store.get_latest();

	if (!result.ok) {
		return c.json({ error: "Not found", message: "No timeline data available" }, 404);
	}

	const timeline = result.value.data as TimelineData;

	if (!from && !to) {
		return c.json({
			meta: result.value.meta,
			data: timeline,
		});
	}

	const filteredGroups = timeline.groups.filter(group => {
		if (from && group.date < from) return false;
		if (to && group.date > to) return false;
		return true;
	});

	return c.json({
		meta: result.value.meta,
		data: { ...timeline, groups: filteredGroups },
	});
});

app.get("/:user_id/raw/:platform", async c => {
	const userId = c.req.param("user_id");
	const platform = c.req.param("platform");
	const auth = c.get("auth");

	if (auth.user_id !== userId) {
		return c.json({ error: "Forbidden", message: "Cannot access other user data" }, 403);
	}

	const accountId = c.req.query("account_id");
	if (!accountId) {
		return c.json({ error: "Bad request", message: "account_id query parameter required" }, 400);
	}

	const { store } = createRawStore(platform, accountId, c.env);
	const result = await store.get_latest();

	if (!result.ok) {
		return c.json({ error: "Not found", message: "No raw data available for this account" }, 404);
	}

	return c.json({
		meta: result.value.meta,
		data: result.value.data,
	});
});

export { app as timelineRoutes };
