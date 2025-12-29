import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthContext, getAuth } from "./auth";
import type { Bindings } from "./bindings";
import type { Database } from "./db";
import type { AppContext } from "./infrastructure";
import { accountMembers, accounts, profileFilters, profileVisibility, profiles } from "./schema/database";
import { AddFilterSchema, CreateProfileSchema, UpdateProfileSchema, UpdateVisibilitySchema } from "./schema/profiles";
import { generateProfileTimeline } from "./timeline-profile";
import { type Result, err, ok, uuid } from "./utils";

type Variables = {
	auth: AuthContext;
	appContext: AppContext;
};

const getContext = (c: Context<{ Bindings: Bindings; Variables: Variables }>): AppContext => {
	const ctx = c.get("appContext");
	if (!ctx) throw new Error("AppContext not set");
	return ctx;
};

type OwnershipError = { status: 404 | 403; error: string; message: string };
type ProfileOwnershipResult = Result<{ profile_id: string }, OwnershipError>;
type AccountOwnershipResult = Result<{ role: string }, OwnershipError>;

const requireProfileOwnership = async (db: Database, userId: string, profileId: string): Promise<ProfileOwnershipResult> => {
	const profile = await db.select({ id: profiles.id, user_id: profiles.user_id }).from(profiles).where(eq(profiles.id, profileId)).get();

	if (!profile) {
		return err({ status: 404, error: "Not found", message: "Profile not found" });
	}

	if (profile.user_id !== userId) {
		return err({ status: 403, error: "Forbidden", message: "You do not own this profile" });
	}

	return ok({ profile_id: profile.id });
};

const requireAccountOwnership = async (db: Database, userId: string, accountId: string): Promise<AccountOwnershipResult> => {
	const membership = await db
		.select({ role: accountMembers.role })
		.from(accountMembers)
		.where(and(eq(accountMembers.user_id, userId), eq(accountMembers.account_id, accountId)))
		.get();

	if (!membership) {
		return err({ status: 404, error: "Not found", message: "Account not found or no access" });
	}

	return ok({ role: membership.role });
};

const checkSlugUniqueness = async (db: Database, userId: string, slug: string, excludeProfileId?: string): Promise<boolean> => {
	const existing = await db
		.select({ id: profiles.id })
		.from(profiles)
		.where(and(eq(profiles.user_id, userId), eq(profiles.slug, slug)))
		.get();

	if (!existing) return true;
	if (excludeProfileId && existing.id === excludeProfileId) return true;
	return false;
};

type ProfileWithRelations = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	theme: string | null;
	created_at: string;
	updated_at: string;
	visibility: Array<{
		account_id: string;
		platform: string;
		platform_username: string | null;
		is_visible: boolean;
	}>;
	filters: Array<{
		id: string;
		account_id: string;
		filter_type: "include" | "exclude";
		filter_key: string;
		filter_value: string;
	}>;
};

const loadProfileWithRelations = async (db: Database, profileId: string, userId: string): Promise<ProfileWithRelations | null> => {
	const profile = await db.select().from(profiles).where(eq(profiles.id, profileId)).get();
	if (!profile || profile.user_id !== userId) return null;

	const userAccounts = await db
		.select({
			id: accounts.id,
			platform: accounts.platform,
			platform_username: accounts.platform_username,
		})
		.from(accounts)
		.innerJoin(accountMembers, eq(accountMembers.account_id, accounts.id))
		.where(eq(accountMembers.user_id, userId));

	const visibilityRows = await db.select().from(profileVisibility).where(eq(profileVisibility.profile_id, profileId));
	const visibilityMap = new Map(visibilityRows.map(v => [v.account_id, v.is_visible ?? true]));

	const visibility = userAccounts.map(account => ({
		account_id: account.id,
		platform: account.platform,
		platform_username: account.platform_username,
		is_visible: visibilityMap.get(account.id) ?? true,
	}));

	const filterRows = await db.select().from(profileFilters).where(eq(profileFilters.profile_id, profileId));

	const filters = filterRows.map(f => ({
		id: f.id,
		account_id: f.account_id,
		filter_type: f.filter_type,
		filter_key: f.filter_key,
		filter_value: f.filter_value,
	}));

	return {
		id: profile.id,
		slug: profile.slug,
		name: profile.name,
		description: profile.description,
		theme: profile.theme,
		created_at: profile.created_at,
		updated_at: profile.updated_at,
		visibility,
		filters,
	};
};

export const profileRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

profileRoutes.get("/", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);

	const userProfiles = await ctx.db
		.select({
			id: profiles.id,
			slug: profiles.slug,
			name: profiles.name,
			description: profiles.description,
			theme: profiles.theme,
			created_at: profiles.created_at,
			updated_at: profiles.updated_at,
		})
		.from(profiles)
		.where(eq(profiles.user_id, auth.user_id));

	return c.json({ profiles: userProfiles });
});

profileRoutes.post("/", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);

	const body = await c.req.json().catch(() => ({}));
	const parseResult = CreateProfileSchema.safeParse(body);

	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}

	const { slug, name, description, theme } = parseResult.data;

	const isUnique = await checkSlugUniqueness(ctx.db, auth.user_id, slug);
	if (!isUnique) {
		return c.json({ error: "Conflict", message: "A profile with this slug already exists" }, 409);
	}

	const now = new Date().toISOString();
	const profileId = uuid();

	await ctx.db.insert(profiles).values({
		id: profileId,
		user_id: auth.user_id,
		slug,
		name,
		description: description ?? null,
		theme: theme ?? null,
		created_at: now,
		updated_at: now,
	});

	const created = await loadProfileWithRelations(ctx.db, profileId, auth.user_id);

	return c.json({ profile: created }, 201);
});

profileRoutes.get("/:id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profileId = c.req.param("id");

	const ownershipResult = await requireProfileOwnership(ctx.db, auth.user_id, profileId);

	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	const profile = await loadProfileWithRelations(ctx.db, profileId, auth.user_id);

	if (!profile) {
		return c.json({ error: "Not found", message: "Profile not found" }, 404);
	}

	return c.json({ profile });
});

profileRoutes.patch("/:id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profileId = c.req.param("id");

	const ownershipResult = await requireProfileOwnership(ctx.db, auth.user_id, profileId);

	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	const body = await c.req.json().catch(() => ({}));
	const parseResult = UpdateProfileSchema.safeParse(body);

	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}

	const updates = parseResult.data;

	if (Object.keys(updates).length === 0) {
		return c.json({ error: "Bad request", message: "No fields to update" }, 400);
	}

	if (updates.slug) {
		const isUnique = await checkSlugUniqueness(ctx.db, auth.user_id, updates.slug, profileId);
		if (!isUnique) {
			return c.json({ error: "Conflict", message: "A profile with this slug already exists" }, 409);
		}
	}

	const now = new Date().toISOString();

	await ctx.db
		.update(profiles)
		.set({
			...updates,
			updated_at: now,
		})
		.where(eq(profiles.id, profileId));

	const updated = await loadProfileWithRelations(ctx.db, profileId, auth.user_id);

	return c.json({ profile: updated });
});

profileRoutes.delete("/:id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profileId = c.req.param("id");

	const ownershipResult = await requireProfileOwnership(ctx.db, auth.user_id, profileId);

	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	await ctx.db.delete(profiles).where(eq(profiles.id, profileId));

	return c.json({ deleted: true, id: profileId });
});

profileRoutes.get("/:id/visibility", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profileId = c.req.param("id");

	const ownershipResult = await requireProfileOwnership(ctx.db, auth.user_id, profileId);
	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	const userAccounts = await ctx.db
		.select({
			account_id: accounts.id,
			platform: accounts.platform,
			platform_username: accounts.platform_username,
			visibility_is_visible: profileVisibility.is_visible,
		})
		.from(accounts)
		.innerJoin(accountMembers, eq(accounts.id, accountMembers.account_id))
		.leftJoin(profileVisibility, and(eq(accounts.id, profileVisibility.account_id), eq(profileVisibility.profile_id, profileId)))
		.where(eq(accountMembers.user_id, auth.user_id));

	const visibility = userAccounts.map(row => ({
		account_id: row.account_id,
		platform: row.platform,
		platform_username: row.platform_username,
		is_visible: row.visibility_is_visible ?? true,
	}));

	return c.json({ visibility });
});

profileRoutes.put("/:id/visibility", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profileId = c.req.param("id");

	const ownershipResult = await requireProfileOwnership(ctx.db, auth.user_id, profileId);
	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	const parseResult = UpdateVisibilitySchema.safeParse(await c.req.json());
	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}

	const { visibility: visibilityUpdates } = parseResult.data;

	const userAccountIds = await ctx.db.select({ account_id: accountMembers.account_id }).from(accountMembers).where(eq(accountMembers.user_id, auth.user_id));

	const ownedAccountIds = new Set(userAccountIds.map(a => a.account_id));

	const invalidAccountIds = visibilityUpdates.filter(v => !ownedAccountIds.has(v.account_id)).map(v => v.account_id);

	if (invalidAccountIds.length > 0) {
		return c.json({ error: "Forbidden", message: `Cannot set visibility for accounts you don't own: ${invalidAccountIds.join(", ")}` }, 403);
	}

	const now = new Date().toISOString();

	for (const update of visibilityUpdates) {
		const existing = await ctx.db
			.select({ id: profileVisibility.id })
			.from(profileVisibility)
			.where(and(eq(profileVisibility.profile_id, profileId), eq(profileVisibility.account_id, update.account_id)))
			.get();

		if (existing) {
			await ctx.db.update(profileVisibility).set({ is_visible: update.is_visible, updated_at: now }).where(eq(profileVisibility.id, existing.id));
		} else {
			await ctx.db.insert(profileVisibility).values({
				id: crypto.randomUUID(),
				profile_id: profileId,
				account_id: update.account_id,
				is_visible: update.is_visible,
				created_at: now,
				updated_at: now,
			});
		}
	}

	return c.json({ updated: true, count: visibilityUpdates.length });
});

profileRoutes.get("/:id/filters", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profileId = c.req.param("id");

	const ownershipResult = await requireProfileOwnership(ctx.db, auth.user_id, profileId);
	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	const filters = await ctx.db
		.select({
			id: profileFilters.id,
			account_id: profileFilters.account_id,
			platform: accounts.platform,
			filter_type: profileFilters.filter_type,
			filter_key: profileFilters.filter_key,
			filter_value: profileFilters.filter_value,
			created_at: profileFilters.created_at,
		})
		.from(profileFilters)
		.innerJoin(accounts, eq(profileFilters.account_id, accounts.id))
		.where(eq(profileFilters.profile_id, profileId));

	return c.json({ filters });
});

profileRoutes.post("/:id/filters", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profileId = c.req.param("id");

	const parseResult = AddFilterSchema.safeParse(await c.req.json());
	if (!parseResult.success) {
		return c.json({ error: "Bad request", details: parseResult.error.flatten() }, 400);
	}
	const body = parseResult.data;

	const ownershipResult = await requireProfileOwnership(ctx.db, auth.user_id, profileId);
	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	const accountOwnership = await requireAccountOwnership(ctx.db, auth.user_id, body.account_id);
	if (!accountOwnership.ok) {
		const { status, error, message } = accountOwnership.error;
		return c.json({ error, message }, status);
	}

	const account = await ctx.db.select({ platform: accounts.platform }).from(accounts).where(eq(accounts.id, body.account_id)).get();

	const now = new Date().toISOString();
	const filterId = uuid();

	await ctx.db.insert(profileFilters).values({
		id: filterId,
		profile_id: profileId,
		account_id: body.account_id,
		filter_type: body.filter_type,
		filter_key: body.filter_key,
		filter_value: body.filter_value,
		created_at: now,
		updated_at: now,
	});

	return c.json(
		{
			id: filterId,
			account_id: body.account_id,
			platform: account?.platform ?? null,
			filter_type: body.filter_type,
			filter_key: body.filter_key,
			filter_value: body.filter_value,
			created_at: now,
		},
		201
	);
});

profileRoutes.delete("/:id/filters/:filter_id", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const profileId = c.req.param("id");
	const filterId = c.req.param("filter_id");

	const ownershipResult = await requireProfileOwnership(ctx.db, auth.user_id, profileId);
	if (!ownershipResult.ok) {
		const { status, error, message } = ownershipResult.error;
		return c.json({ error, message }, status);
	}

	const filter = await ctx.db
		.select({ id: profileFilters.id })
		.from(profileFilters)
		.where(and(eq(profileFilters.id, filterId), eq(profileFilters.profile_id, profileId)))
		.get();

	if (!filter) {
		return c.json({ error: "Not found", message: "Filter not found" }, 404);
	}

	await ctx.db.delete(profileFilters).where(eq(profileFilters.id, filterId));

	return new Response(null, { status: 204 });
});

const ProfileTimelineQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(500).optional().default(100),
	before: z.string().datetime().optional(),
});

profileRoutes.get("/:slug/timeline", async c => {
	const auth = getAuth(c);
	const ctx = getContext(c);
	const { slug } = c.req.param();

	const queryResult = ProfileTimelineQuerySchema.safeParse({
		limit: c.req.query("limit"),
		before: c.req.query("before"),
	});

	if (!queryResult.success) {
		return c.json({ error: "Bad request", details: queryResult.error.flatten() }, 400);
	}

	const { limit, before } = queryResult.data;

	const profile = await ctx.db
		.select({ id: profiles.id, slug: profiles.slug, name: profiles.name, user_id: profiles.user_id })
		.from(profiles)
		.where(and(eq(profiles.slug, slug), eq(profiles.user_id, auth.user_id)))
		.get();

	if (!profile) {
		return c.json({ error: "Not found", message: "Profile not found" }, 404);
	}

	const result = await generateProfileTimeline({
		db: ctx.db,
		backend: ctx.backend,
		profileId: profile.id,
		limit,
		before,
	});

	if (!result.ok) {
		const error = result.error;
		if (error.kind === "profile_not_found") {
			return c.json({ error: "Not found", message: "Profile not found" }, 404);
		}
		if (error.kind === "timeline_generation_failed") {
			return c.json({ error: "Internal error", message: error.message }, 500);
		}
		return c.json({ error: "Internal error", message: "Timeline generation failed" }, 500);
	}

	return c.json(result.value);
});
