import { type CorpusError as LibCorpusError } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { getAuth } from "./auth";
import type { Bindings } from "./bindings";
import type { AppContext } from "./infrastructure";
import { accountMembers, accounts, DateGroupSchema } from "./schema";
import { createRawStore, createTimelineStore, RawDataSchema, type CorpusError } from "./storage";
import { encrypt, err, match, ok, pipe, type Result } from "./utils";

type Variables = {
	auth: { user_id: string; key_id: string };
	appContext: AppContext;
};

const getContext = (c: Context<{ Bindings: Bindings; Variables: Variables }>): AppContext => {
	const ctx = c.get("appContext");
	if (!ctx) throw new Error("AppContext not set");
	return ctx;
};

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

type TimelineRouteError = CorpusError | LibCorpusError | { kind: "validation_error"; message: string };
type RawRouteError = CorpusError | LibCorpusError | { kind: "validation_error"; message: string };

const CreateConnectionBodySchema = z.object({
	platform: z.enum(["github", "bluesky", "youtube", "devpad"]),
	access_token: z.string().min(1),
	refresh_token: z.string().optional(),
	platform_user_id: z.string().optional(),
	platform_username: z.string().optional(),
	token_expires_at: z.string().optional(),
});

const AddMemberBodySchema = z.object({
	user_id: z.string().min(1),
});

export const timelineRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

timelineRoutes.get("/:user_id", async c => {
	const userId = c.req.param("user_id");
	const auth = getAuth(c);
	const ctx = getContext(c);

	if (auth.user_id !== userId) {
		return c.json({ error: "Forbidden", message: "Cannot access other user timelines" }, 403);
	}

	const from = c.req.query("from");
	const to = c.req.query("to");

	const result = await pipe(createTimelineStore(ctx.backend, userId))
		.mapErr((e): TimelineRouteError => e)
		.map(({ store }) => store)
		.flatMap(async (store): Promise<Result<unknown, TimelineRouteError>> => {
			const latest = await store.get_latest();
			if (!latest.ok) return err(latest.error);
			return ok(latest.value);
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
			if (error.kind === "not_found") {
				return c.json({ error: "Not found", message: "No timeline data available" }, 404) as Response;
			}
			return c.json({ error: "Internal error", message: "Unexpected error" }, 500) as Response;
		}
	);
});

timelineRoutes.get("/:user_id/raw/:platform", async c => {
	const userId = c.req.param("user_id");
	const platform = c.req.param("platform");
	const auth = getAuth(c);
	const ctx = getContext(c);

	if (auth.user_id !== userId) {
		return c.json({ error: "Forbidden", message: "Cannot access other user data" }, 403);
	}

	const accountId = c.req.query("account_id");
	if (!accountId) {
		return c.json({ error: "Bad request", message: "account_id query parameter required" }, 400);
	}

	const result = await pipe(createRawStore(ctx.backend, platform, accountId))
		.mapErr((e): RawRouteError => e)
		.map(({ store }) => store)
		.flatMap(async (store): Promise<Result<unknown, RawRouteError>> => {
			const latest = await store.get_latest();
			if (!latest.ok) return err(latest.error);
			return ok(latest.value);
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
			if (error.kind === "not_found") {
				return c.json({ error: "Not found", message: "No raw data available for this account" }, 404) as Response;
			}
			return c.json({ error: "Internal error", message: "Unexpected error" }, 500) as Response;
		}
	);
});

export const connectionRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

connectionRoutes.get("/", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);

	const results = await ctx.db
		.select({
			account_id: accounts.id,
			platform: accounts.platform,
			platform_username: accounts.platform_username,
			is_active: accounts.is_active,
			last_fetched_at: accounts.last_fetched_at,
			role: accountMembers.role,
			created_at: accountMembers.created_at,
		})
		.from(accountMembers)
		.innerJoin(accounts, eq(accountMembers.account_id, accounts.id))
		.where(eq(accountMembers.user_id, auth.user_id));

	return c.json({ accounts: results });
});

connectionRoutes.post("/", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const parseResult = CreateConnectionBodySchema.safeParse(await c.req.json());
	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}
	const body = parseResult.data;

	const now = new Date().toISOString();
	const accountId = crypto.randomUUID();
	const memberId = crypto.randomUUID();

	const result = await pipe(encrypt(body.access_token, ctx.encryptionKey))
		.flatMap(encryptedAccessToken =>
			body.refresh_token
				? pipe(encrypt(body.refresh_token, ctx.encryptionKey))
						.map(encryptedRefreshToken => ({ encryptedAccessToken, encryptedRefreshToken: encryptedRefreshToken as string | null }))
						.result()
				: Promise.resolve(ok({ encryptedAccessToken, encryptedRefreshToken: null as string | null }))
		)
		.tap(async ({ encryptedAccessToken, encryptedRefreshToken }) => {
			await ctx.db.batch([
				ctx.db.insert(accounts).values({
					id: accountId,
					platform: body.platform,
					platform_user_id: body.platform_user_id ?? null,
					platform_username: body.platform_username ?? null,
					access_token_encrypted: encryptedAccessToken,
					refresh_token_encrypted: encryptedRefreshToken,
					token_expires_at: body.token_expires_at ?? null,
					is_active: true,
					created_at: now,
					updated_at: now,
				}),
				ctx.db.insert(accountMembers).values({
					id: memberId,
					user_id: auth.user_id,
					account_id: accountId,
					role: "owner",
					created_at: now,
				}),
			]);
		})
		.result();

	return match(
		result,
		() => c.json({ account_id: accountId, role: "owner" }, 201) as Response,
		() => c.json({ error: "Internal error", message: "Failed to encrypt token" }, 500) as Response
	);
});

connectionRoutes.delete("/:account_id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");

	const membership = await ctx.db
		.select({ role: accountMembers.role })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (membership.role !== "owner") {
		return c.json({ error: "Forbidden", message: "Only owners can delete accounts" }, 403);
	}

	const now = new Date().toISOString();
	await ctx.db.update(accounts).set({ is_active: false, updated_at: now }).where(eq(accounts.id, accountId));

	return c.json({ deleted: true });
});

connectionRoutes.post("/:account_id/members", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const accountId = c.req.param("account_id");
	const parseResult = AddMemberBodySchema.safeParse(await c.req.json());
	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}
	const body = parseResult.data;

	const membership = await ctx.db
		.select({ role: accountMembers.role })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, auth.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (membership.role !== "owner") {
		return c.json({ error: "Forbidden", message: "Only owners can add members" }, 403);
	}

	const existingMember = await ctx.db
		.select({ id: accountMembers.id })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, body.user_id), eq(accountMembers.account_id, accountId)))
		.get();

	if (existingMember) {
		return c.json({ error: "Conflict", message: "User is already a member" }, 409);
	}

	const memberId = crypto.randomUUID();
	const now = new Date().toISOString();

	await ctx.db.insert(accountMembers).values({
		id: memberId,
		user_id: body.user_id,
		account_id: accountId,
		role: "member",
		created_at: now,
	});

	return c.json({ member_id: memberId, role: "member" }, 201);
});
