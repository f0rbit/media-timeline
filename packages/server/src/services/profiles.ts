import { type ProfileId, type UserId, accountId, errors, profileId } from "@media/schema";
import { accounts, profileFilters, profiles, users } from "@media/schema";
import { and, eq } from "drizzle-orm";
import { requireAccountOwnership } from "../auth-ownership";
import type { Database } from "../db";
import type { AppContext } from "../infrastructure";
import { type ProfileTimelineOptions, type ProfileTimelineResult, generateProfileTimeline } from "../timeline";
import { type Result, ok, uuid } from "../utils";
import type { ServiceError } from "../utils/route-helpers";

type ProfileWithRelations = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	theme: string | null;
	created_at: string;
	updated_at: string;
	filters: Array<{
		id: string;
		account_id: string;
		filter_type: "include" | "exclude";
		filter_key: string;
		filter_value: string;
	}>;
};

type CreateProfileInput = {
	slug: string;
	name: string;
	description?: string | null;
	theme?: string | null;
};

type UpdateProfileInput = Partial<CreateProfileInput>;

type AddFilterInput = {
	account_id: string;
	filter_type: "include" | "exclude";
	filter_key: string;
	filter_value: string;
};

type FilterWithPlatform = {
	id: string;
	account_id: string;
	platform: string | null;
	filter_type: "include" | "exclude";
	filter_key: string;
	filter_value: string;
	created_at: string;
};

const requireProfileOwnership = async (db: Database, uid: UserId, profId: ProfileId): Promise<Result<{ profile_id: ProfileId }, ServiceError>> => {
	const profile = await db.select({ id: profiles.id, user_id: profiles.user_id }).from(profiles).where(eq(profiles.id, profId)).get();

	if (!profile) {
		return errors.notFound("profile");
	}

	if (profile.user_id !== uid) {
		return errors.forbidden("You do not own this profile");
	}

	return ok({ profile_id: profileId(profile.id) });
};

const checkSlugUniqueness = async (db: Database, uid: string, slug: string, excludeProfileId?: string): Promise<boolean> => {
	const existing = await db
		.select({ id: profiles.id })
		.from(profiles)
		.where(and(eq(profiles.user_id, uid), eq(profiles.slug, slug)))
		.get();

	if (!existing) return true;
	if (excludeProfileId && existing.id === excludeProfileId) return true;
	return false;
};

const loadProfileWithRelations = async (db: Database, profId: string, uid: string): Promise<ProfileWithRelations | null> => {
	const profile = await db.select().from(profiles).where(eq(profiles.id, profId)).get();
	if (!profile || profile.user_id !== uid) return null;

	const filterRows = await db.select().from(profileFilters).where(eq(profileFilters.profile_id, profId));

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
		filters,
	};
};

type ProfileListItem = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	theme: string | null;
	created_at: string;
	updated_at: string;
};

type UserInfo = {
	id: string;
	name: string | null;
	email: string | null;
};

const ensureUserExists = async (db: AppContext["db"], user: UserInfo): Promise<void> => {
	const existing = await db.select({ id: users.id }).from(users).where(eq(users.id, user.id)).get();
	if (existing) return;

	const now = new Date().toISOString();
	await db.insert(users).values({
		id: user.id,
		name: user.name,
		email: user.email,
		created_at: now,
		updated_at: now,
	});
};

export const listProfiles = async (ctx: AppContext, uid: UserId): Promise<Result<{ profiles: ProfileListItem[] }, ServiceError>> => {
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
		.where(eq(profiles.user_id, uid));

	return ok({ profiles: userProfiles });
};

export const createProfile = async (ctx: AppContext, uid: UserId, user: UserInfo, input: CreateProfileInput): Promise<Result<{ profile: ProfileWithRelations | null }, ServiceError>> => {
	await ensureUserExists(ctx.db, user);

	const isUnique = await checkSlugUniqueness(ctx.db, uid, input.slug);
	if (!isUnique) {
		return errors.conflict("profile", "A profile with this slug already exists");
	}

	const now = new Date().toISOString();
	const newProfileId = uuid();

	await ctx.db.insert(profiles).values({
		id: newProfileId,
		user_id: uid,
		slug: input.slug,
		name: input.name,
		description: input.description ?? null,
		theme: input.theme ?? null,
		created_at: now,
		updated_at: now,
	});

	const created = await loadProfileWithRelations(ctx.db, newProfileId, uid);
	return ok({ profile: created });
};

export const getProfile = async (ctx: AppContext, uid: UserId, profId: ProfileId): Promise<Result<{ profile: ProfileWithRelations | null }, ServiceError>> => {
	const ownershipResult = await requireProfileOwnership(ctx.db, uid, profId);
	if (!ownershipResult.ok) return ownershipResult;

	const profile = await loadProfileWithRelations(ctx.db, profId, uid);
	if (!profile) {
		return errors.notFound("profile");
	}

	return ok({ profile });
};

export const updateProfile = async (ctx: AppContext, uid: UserId, profId: ProfileId, updates: UpdateProfileInput): Promise<Result<{ profile: ProfileWithRelations | null }, ServiceError>> => {
	const ownershipResult = await requireProfileOwnership(ctx.db, uid, profId);
	if (!ownershipResult.ok) return ownershipResult;

	if (Object.keys(updates).length === 0) {
		return errors.badRequest("No fields to update");
	}

	if (updates.slug) {
		const isUnique = await checkSlugUniqueness(ctx.db, uid, updates.slug, profId);
		if (!isUnique) {
			return errors.conflict("profile", "A profile with this slug already exists");
		}
	}

	const now = new Date().toISOString();

	await ctx.db
		.update(profiles)
		.set({
			...updates,
			updated_at: now,
		})
		.where(eq(profiles.id, profId));

	const updated = await loadProfileWithRelations(ctx.db, profId, uid);
	return ok({ profile: updated });
};

export const deleteProfile = async (ctx: AppContext, uid: UserId, profId: ProfileId): Promise<Result<{ deleted: boolean; id: string }, ServiceError>> => {
	const ownershipResult = await requireProfileOwnership(ctx.db, uid, profId);
	if (!ownershipResult.ok) return ownershipResult;

	await ctx.db.delete(profiles).where(eq(profiles.id, profId));

	return ok({ deleted: true, id: profId });
};

export const listProfileFilters = async (ctx: AppContext, uid: UserId, profId: ProfileId): Promise<Result<{ filters: FilterWithPlatform[] }, ServiceError>> => {
	const ownershipResult = await requireProfileOwnership(ctx.db, uid, profId);
	if (!ownershipResult.ok) return ownershipResult;

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
		.where(eq(profileFilters.profile_id, profId));

	return ok({ filters });
};

export const addProfileFilter = async (ctx: AppContext, uid: UserId, profId: ProfileId, input: AddFilterInput): Promise<Result<FilterWithPlatform, ServiceError>> => {
	const ownershipResult = await requireProfileOwnership(ctx.db, uid, profId);
	if (!ownershipResult.ok) return ownershipResult;

	const accId = accountId(input.account_id);
	const accountOwnership = await requireAccountOwnership(ctx.db, uid, accId);
	if (!accountOwnership.ok) {
		const { kind } = accountOwnership.error;
		if (kind === "not_found") return errors.notFound("account");
		return errors.forbidden("You do not own this account");
	}

	const account = await ctx.db.select({ platform: accounts.platform }).from(accounts).where(eq(accounts.id, input.account_id)).get();

	const now = new Date().toISOString();
	const filterId = uuid();

	await ctx.db.insert(profileFilters).values({
		id: filterId,
		profile_id: profId,
		account_id: input.account_id,
		filter_type: input.filter_type,
		filter_key: input.filter_key,
		filter_value: input.filter_value,
		created_at: now,
		updated_at: now,
	});

	return ok({
		id: filterId,
		account_id: input.account_id,
		platform: account?.platform ?? null,
		filter_type: input.filter_type,
		filter_key: input.filter_key,
		filter_value: input.filter_value,
		created_at: now,
	});
};

export const deleteProfileFilter = async (ctx: AppContext, uid: UserId, profId: ProfileId, filterId: string): Promise<Result<void, ServiceError>> => {
	const ownershipResult = await requireProfileOwnership(ctx.db, uid, profId);
	if (!ownershipResult.ok) return ownershipResult;

	const filter = await ctx.db
		.select({ id: profileFilters.id })
		.from(profileFilters)
		.where(and(eq(profileFilters.id, filterId), eq(profileFilters.profile_id, profId)))
		.get();

	if (!filter) {
		return errors.notFound("filter");
	}

	await ctx.db.delete(profileFilters).where(eq(profileFilters.id, filterId));

	return ok(undefined);
};

type TimelineQueryOptions = {
	limit?: number;
	before?: string;
};

export const getProfileTimeline = async (ctx: AppContext, uid: UserId, slug: string, options: TimelineQueryOptions): Promise<Result<ProfileTimelineResult, ServiceError>> => {
	const { limit = 100, before } = options;

	const profile = await ctx.db
		.select({ id: profiles.id, slug: profiles.slug, name: profiles.name, user_id: profiles.user_id })
		.from(profiles)
		.where(and(eq(profiles.slug, slug), eq(profiles.user_id, uid)))
		.get();

	if (!profile) {
		return errors.notFound("profile");
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
		if (error.kind === "not_found") {
			return errors.notFound("profile");
		}
		if (error.kind === "store_error") {
			return errors.storeError("timeline_generation", error.message);
		}
		return errors.storeError("timeline_generation", "Timeline generation failed");
	}

	return ok(result.value);
};
