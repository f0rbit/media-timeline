import { fromExternalResult, matchResult, pipeResultAsync, type Result } from "@media-timeline/core";
import { Hono } from "hono";
import type { Bindings } from "../bindings";
import { type CorpusError, createRawStore, createTimelineStore } from "../corpus";
import { authMiddleware } from "../middleware/auth";

type TimelineData = {
	groups: Array<{ date: string; items: unknown[] }>;
};

type Snapshot = { meta: unknown; data: unknown };

type TimelineRouteError = CorpusError | { kind: "not_found" };

type RawRouteError = CorpusError | { kind: "not_found" };

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

	const result = await pipeResultAsync(Promise.resolve(createTimelineStore(userId, c.env)))
		.mapErr((e): TimelineRouteError => e)
		.map(({ store }) => store)
		.flatMapAsync(async (store): Promise<Result<Snapshot, TimelineRouteError>> => fromExternalResult(await store.get_latest(), { kind: "not_found" }))
		.map(snapshot => {
			const timeline = snapshot.data as TimelineData;
			const filteredGroups = timeline.groups.filter(group => {
				if (from && group.date < from) return false;
				if (to && group.date > to) return false;
				return true;
			});
			return { meta: snapshot.meta, data: { ...timeline, groups: filteredGroups } };
		})
		.result();

	return matchResult(
		result,
		data => c.json(data) as Response,
		error =>
			error.kind === "store_not_found" ? (c.json({ error: "Internal error", message: "Failed to create timeline store" }, 500) as Response) : (c.json({ error: "Not found", message: "No timeline data available" }, 404) as Response)
	);
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

	const result = await pipeResultAsync(Promise.resolve(createRawStore(platform, accountId, c.env)))
		.mapErr((e): RawRouteError => e)
		.map(({ store }) => store)
		.flatMapAsync(async (store): Promise<Result<Snapshot, RawRouteError>> => fromExternalResult(await store.get_latest(), { kind: "not_found" }))
		.map(snapshot => ({ meta: snapshot.meta, data: snapshot.data }))
		.result();

	return matchResult(
		result,
		data => c.json(data) as Response,
		error =>
			error.kind === "store_not_found"
				? (c.json({ error: "Internal error", message: "Failed to create raw store" }, 500) as Response)
				: (c.json({ error: "Not found", message: "No raw data available for this account" }, 404) as Response)
	);
});

export { app as timelineRoutes };
