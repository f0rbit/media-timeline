import { err, match, ok, pipe, type Result } from "@media-timeline/core";
import { DateGroupSchema } from "@media-timeline/schema";
import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../bindings";
import { type CorpusError, createRawStore, createTimelineStore, RawDataSchema } from "../corpus";
import { authMiddleware } from "../middleware/auth";

const TimelineDataSchema = z.object({
	groups: z.array(DateGroupSchema),
});

const SnapshotMetaSchema = z
	.object({
		version: z.number(),
		created_at: z.string(),
	})
	.passthrough();

const TimelineSnapshotSchema = z.object({
	meta: SnapshotMetaSchema,
	data: TimelineDataSchema,
});

const RawSnapshotSchema = z.object({
	meta: SnapshotMetaSchema,
	data: RawDataSchema,
});

type TimelineSnapshot = z.infer<typeof TimelineSnapshotSchema>;
type RawSnapshot = z.infer<typeof RawSnapshotSchema>;

type TimelineRouteError = CorpusError | { kind: "not_found" } | { kind: "validation_error"; message: string };
type RawRouteError = CorpusError | { kind: "not_found" } | { kind: "validation_error"; message: string };

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

	const result = await pipe(createTimelineStore(userId, c.env))
		.mapErr((e): TimelineRouteError => e)
		.map(({ store }) => store)
		.flatMap(async (store): Promise<Result<unknown, TimelineRouteError>> => {
			const latest = (await store.get_latest()) as Result<unknown, unknown>;
			return latest.ok ? ok(latest.value) : err({ kind: "not_found" });
		})
		.flatMap((raw): Result<TimelineSnapshot, TimelineRouteError> => {
			const parsed = TimelineSnapshotSchema.safeParse(raw);
			return parsed.success ? ok(parsed.data) : err({ kind: "validation_error", message: parsed.error.message });
		})
		.map(snapshot => {
			const filteredGroups = snapshot.data.groups.filter(group => {
				if (from && group.date < from) return false;
				if (to && group.date > to) return false;
				return true;
			});
			return { meta: snapshot.meta, data: { ...snapshot.data, groups: filteredGroups } };
		})
		.result();

	return match(
		result,
		data => c.json(data) as Response,
		error => {
			if (error.kind === "store_not_found") {
				return c.json({ error: "Internal error", message: "Failed to create timeline store" }, 500) as Response;
			}
			if (error.kind === "validation_error") {
				return c.json({ error: "Internal error", message: "Invalid timeline data format" }, 500) as Response;
			}
			return c.json({ error: "Not found", message: "No timeline data available" }, 404) as Response;
		}
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

	const result = await pipe(createRawStore(platform, accountId, c.env))
		.mapErr((e): RawRouteError => e)
		.map(({ store }) => store)
		.flatMap(async (store): Promise<Result<unknown, RawRouteError>> => {
			const latest = (await store.get_latest()) as Result<unknown, unknown>;
			return latest.ok ? ok(latest.value) : err({ kind: "not_found" });
		})
		.flatMap((raw): Result<RawSnapshot, RawRouteError> => {
			const parsed = RawSnapshotSchema.safeParse(raw);
			return parsed.success ? ok(parsed.data) : err({ kind: "validation_error", message: parsed.error.message });
		})
		.map(snapshot => ({ meta: snapshot.meta, data: snapshot.data }))
		.result();

	return match(
		result,
		data => c.json(data) as Response,
		error => {
			if (error.kind === "store_not_found") {
				return c.json({ error: "Internal error", message: "Failed to create raw store" }, 500) as Response;
			}
			if (error.kind === "validation_error") {
				return c.json({ error: "Internal error", message: "Invalid raw data format" }, 500) as Response;
			}
			return c.json({ error: "Not found", message: "No raw data available for this account" }, 404) as Response;
		}
	);
});

export { app as timelineRoutes };
