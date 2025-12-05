import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "./bindings";
import { DateGroupSchema } from "./schema";
import { createRawStore, createTimelineStore, RawDataSchema, type CorpusError } from "./storage";
import { encrypt, err, match, ok, pipe, type Result } from "./utils";

type AuthContext = {
	user_id: string;
	key_id: string;
};

declare module "hono" {
	interface ContextVariableMap {
		auth: AuthContext;
	}
}

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

type AccountRow = {
	account_id: string;
	platform: string;
	platform_username: string | null;
	is_active: number;
	last_fetched_at: string | null;
	role: string;
	created_at: string;
};

type MembershipRow = {
	role: string;
};

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

export const timelineRoutes = new Hono<{ Bindings: Bindings }>();

timelineRoutes.get("/:user_id", async c => {
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

timelineRoutes.get("/:user_id/raw/:platform", async c => {
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

export const connectionRoutes = new Hono<{ Bindings: Bindings }>();

connectionRoutes.get("/", async c => {
	const auth = c.get("auth");

	const { results } = await c.env.DB.prepare(`
      SELECT 
        a.id as account_id,
        a.platform,
        a.platform_username,
        a.is_active,
        a.last_fetched_at,
        am.role,
        am.created_at
      FROM account_members am
      INNER JOIN accounts a ON am.account_id = a.id
      WHERE am.user_id = ?
    `)
		.bind(auth.user_id)
		.all<AccountRow>();

	return c.json({ accounts: results });
});

connectionRoutes.post("/", async c => {
	const auth = c.get("auth");
	const parseResult = CreateConnectionBodySchema.safeParse(await c.req.json());
	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}
	const body = parseResult.data;

	const now = new Date().toISOString();
	const accountId = crypto.randomUUID();
	const memberId = crypto.randomUUID();

	const result = await pipe(encrypt(body.access_token, c.env.ENCRYPTION_KEY))
		.flatMap(encryptedAccessToken =>
			body.refresh_token
				? pipe(encrypt(body.refresh_token, c.env.ENCRYPTION_KEY))
						.map(encryptedRefreshToken => ({ encryptedAccessToken, encryptedRefreshToken: encryptedRefreshToken as string | null }))
						.result()
				: Promise.resolve(ok({ encryptedAccessToken, encryptedRefreshToken: null as string | null }))
		)
		.tap(async ({ encryptedAccessToken, encryptedRefreshToken }) => {
			await c.env.DB.batch([
				c.env.DB.prepare(`
        INSERT INTO accounts (id, platform, platform_user_id, platform_username, access_token_encrypted, refresh_token_encrypted, token_expires_at, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).bind(accountId, body.platform, body.platform_user_id ?? null, body.platform_username ?? null, encryptedAccessToken, encryptedRefreshToken, body.token_expires_at ?? null, now, now),
				c.env.DB.prepare(`
        INSERT INTO account_members (id, user_id, account_id, role, created_at)
        VALUES (?, ?, ?, 'owner', ?)
      `).bind(memberId, auth.user_id, accountId, now),
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
	const auth = c.get("auth");
	const accountId = c.req.param("account_id");

	const membership = await c.env.DB.prepare("SELECT role FROM account_members WHERE user_id = ? AND account_id = ?").bind(auth.user_id, accountId).first<MembershipRow>();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (membership.role !== "owner") {
		return c.json({ error: "Forbidden", message: "Only owners can delete accounts" }, 403);
	}

	const now = new Date().toISOString();
	await c.env.DB.prepare("UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?").bind(now, accountId).run();

	return c.json({ deleted: true });
});

connectionRoutes.post("/:account_id/members", async c => {
	const auth = c.get("auth");
	const accountId = c.req.param("account_id");
	const parseResult = AddMemberBodySchema.safeParse(await c.req.json());
	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}
	const body = parseResult.data;

	const membership = await c.env.DB.prepare("SELECT role FROM account_members WHERE user_id = ? AND account_id = ?").bind(auth.user_id, accountId).first<MembershipRow>();

	if (!membership) {
		return c.json({ error: "Not found", message: "Account not found" }, 404);
	}

	if (membership.role !== "owner") {
		return c.json({ error: "Forbidden", message: "Only owners can add members" }, 403);
	}

	const existingMember = await c.env.DB.prepare("SELECT id FROM account_members WHERE user_id = ? AND account_id = ?").bind(body.user_id, accountId).first<{ id: string }>();

	if (existingMember) {
		return c.json({ error: "Conflict", message: "User is already a member" }, 409);
	}

	const memberId = crypto.randomUUID();
	const now = new Date().toISOString();

	await c.env.DB.prepare("INSERT INTO account_members (id, user_id, account_id, role, created_at) VALUES (?, ?, ?, ?, ?)").bind(memberId, body.user_id, accountId, "member", now).run();

	return c.json({ member_id: memberId, role: "member" }, 201);
});
