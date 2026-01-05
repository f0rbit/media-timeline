import type { CorpusError as LibCorpusError } from "@f0rbit/corpus";
import { DateGroupSchema, accounts, errors, profiles } from "@media/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "../infrastructure/context";
import { type CorpusError, RawDataSchema, createRawStore, createTimelineStore } from "../storage";
import { type Result, err, ok, pipe } from "../utils";
import type { ServiceError } from "../utils/route-helpers";

const TimelineDataSchema = z.object({
	groups: z.array(DateGroupSchema),
});

const SnapshotMetaSchema = z
	.object({
		version: z.union([z.string(), z.number()]),
		created_at: z.union([z.string(), z.date()]),
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

type TimelineGetError = { kind: "store_error"; status: 500 } | { kind: "not_found"; status: 404 } | { kind: "parse_error"; status: 500 };

type RawRouteError = CorpusError | LibCorpusError | { kind: "validation_error"; message: string };

type TimelineOptions = {
	from?: string;
	to?: string;
};

type TimelineResult = {
	meta: { version: string | number; created_at: string | Date; github_usernames: string[] };
	data: { groups: z.infer<typeof DateGroupSchema>[] };
};

export const getTimeline = async (ctx: AppContext, userId: string, options: TimelineOptions): Promise<Result<TimelineResult, ServiceError>> => {
	const { from, to } = options;

	const githubAccounts = await ctx.db
		.select({ platform_username: accounts.platform_username })
		.from(accounts)
		.innerJoin(profiles, eq(accounts.profile_id, profiles.id))
		.where(and(eq(profiles.user_id, userId), eq(accounts.platform, "github"), eq(accounts.is_active, true)));

	const githubUsernames = githubAccounts.map(a => a.platform_username).filter((u): u is string => u !== null);

	const result = await pipe(createTimelineStore(ctx.backend, userId))
		.map_err((): TimelineGetError => ({ kind: "store_error", status: 500 }))
		.map(({ store }) => store)
		.flat_map(async (store): Promise<Result<TimelineSnapshot, TimelineGetError>> => {
			const latest = await store.get_latest();
			if (!latest.ok) {
				return latest.error.kind === "not_found" ? err({ kind: "not_found" as const, status: 404 as const }) : err({ kind: "store_error" as const, status: 500 as const });
			}
			return ok(latest.value as TimelineSnapshot);
		})
		.flat_map((raw): Result<TimelineSnapshot, TimelineGetError> => {
			const parsed = TimelineSnapshotSchema.safeParse(raw);
			return parsed.success ? ok(parsed.data) : err({ kind: "parse_error" as const, status: 500 as const });
		})
		.map(snapshot => {
			const filteredGroups = snapshot.data.groups.filter(group => {
				if (from && group.date < from) return false;
				if (to && group.date > to) return false;
				return true;
			});
			return {
				meta: { ...snapshot.meta, github_usernames: githubUsernames },
				data: { ...snapshot.data, groups: filteredGroups },
			};
		})
		.result();

	if (!result.ok) {
		const errorMap: Record<TimelineGetError["kind"], () => Result<never, ServiceError>> = {
			store_error: () => errors.storeError("get_timeline", "Failed to create timeline store"),
			not_found: () => errors.notFound("timeline"),
			parse_error: () => errors.parseError("Invalid timeline data format"),
		};
		return errorMap[result.error.kind]();
	}

	return ok(result.value);
};

type RawDataResult = {
	meta: { version: string | number; created_at: string | Date };
	data: z.infer<typeof RawDataSchema>;
};

export const getRawPlatformData = async (ctx: AppContext, userId: string, platform: string, accountId: string): Promise<Result<RawDataResult, ServiceError>> => {
	const result = await pipe(createRawStore(ctx.backend, platform, accountId))
		.map_err((e): RawRouteError => e)
		.map(({ store }) => store)
		.flat_map(async (store): Promise<Result<unknown, RawRouteError>> => {
			const latest = await store.get_latest();
			if (!latest.ok) return err(latest.error);
			return ok(latest.value);
		})
		.flat_map((raw): Result<RawSnapshot, RawRouteError> => {
			const parsed = RawSnapshotSchema.safeParse(raw);
			return parsed.success ? ok(parsed.data) : err({ kind: "validation_error", message: parsed.error.message });
		})
		.map(snapshot => ({ meta: snapshot.meta, data: snapshot.data }))
		.result();

	if (!result.ok) {
		const error = result.error;
		if (error.kind === "store_error") {
			return errors.storeError("create_raw_store", "Failed to create raw store");
		}
		if (error.kind === "validation_error") {
			return errors.parseError("Invalid raw data format");
		}
		if (error.kind === "not_found") {
			return errors.notFound("raw_data");
		}
		return errors.storeError("get_raw", "Unexpected error");
	}

	return ok(result.value);
};
