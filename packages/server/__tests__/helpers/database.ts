import type { Platform } from "@media/schema";
import * as schema from "@media/schema/database";
import { encrypt, hash_api_key, unwrap, uuid } from "@media/server/utils";
import { sql } from "drizzle-orm";
import type { TestContext } from "./types";

export type UserSeed = {
	id: string;
	email?: string;
	name?: string;
};

export type AccountSeed = {
	id: string;
	platform: Platform;
	platform_user_id?: string;
	platform_username?: string;
	access_token: string;
	refresh_token?: string;
	is_active?: boolean;
};

export type RateLimitSeed = {
	remaining?: number | null;
	limit_total?: number | null;
	reset_at?: Date | null;
	consecutive_failures?: number;
	last_failure_at?: Date | null;
	circuit_open_until?: Date | null;
};

export type ProfileSeed = {
	id: string;
	slug: string;
	name: string;
	description?: string;
	theme?: string;
};

export type ProfileFilterSeed = {
	account_id: string;
	filter_type: "include" | "exclude";
	filter_key: string;
	filter_value: string;
};

const ENCRYPTION_KEY = "test-encryption-key-32-bytes-long!";

export const encryptToken = async (plaintext: string, key: string = ENCRYPTION_KEY): Promise<string> => {
	return unwrap(await encrypt(plaintext, key));
};

const now = () => new Date().toISOString();

export const seedUser = async (ctx: TestContext, user: UserSeed): Promise<void> => {
	const timestamp = now();
	await ctx.drizzle.insert(schema.users).values({
		id: user.id,
		email: user.email ?? null,
		name: user.name ?? null,
		created_at: timestamp,
		updated_at: timestamp,
	});
};

export const seedAccount = async (ctx: TestContext, profileId: string, account: AccountSeed): Promise<void> => {
	const timestamp = now();
	const encryptedAccessToken = await encryptToken(account.access_token, ctx.env.ENCRYPTION_KEY);
	const encryptedRefreshToken = account.refresh_token ? await encryptToken(account.refresh_token, ctx.env.ENCRYPTION_KEY) : null;

	await ctx.drizzle.insert(schema.accounts).values({
		id: account.id,
		profile_id: profileId,
		platform: account.platform,
		platform_user_id: account.platform_user_id ?? null,
		platform_username: account.platform_username ?? null,
		access_token_encrypted: encryptedAccessToken,
		refresh_token_encrypted: encryptedRefreshToken,
		is_active: account.is_active ?? true,
		created_at: timestamp,
		updated_at: timestamp,
	});
};

export const seedRateLimit = async (ctx: TestContext, accountId: string, state: RateLimitSeed): Promise<void> => {
	const timestamp = now();
	await ctx.drizzle.insert(schema.rateLimits).values({
		id: uuid(),
		account_id: accountId,
		remaining: state.remaining ?? null,
		limit_total: state.limit_total ?? null,
		reset_at: state.reset_at?.toISOString() ?? null,
		consecutive_failures: state.consecutive_failures ?? 0,
		last_failure_at: state.last_failure_at?.toISOString() ?? null,
		circuit_open_until: state.circuit_open_until?.toISOString() ?? null,
		updated_at: timestamp,
	});
};

export const seedApiKey = async (ctx: TestContext, userId: string, keyValue: string, name?: string): Promise<string> => {
	const keyId = uuid();
	const keyHash = await hash_api_key(keyValue);
	const timestamp = now();

	await ctx.drizzle.insert(schema.apiKeys).values({
		id: keyId,
		user_id: userId,
		key_hash: keyHash,
		name: name ?? null,
		created_at: timestamp,
	});

	return keyId;
};

export const seedProfile = async (ctx: TestContext, userId: string, profile: ProfileSeed): Promise<void> => {
	const timestamp = now();
	await ctx.drizzle.insert(schema.profiles).values({
		id: profile.id,
		user_id: userId,
		slug: profile.slug,
		name: profile.name,
		description: profile.description ?? null,
		theme: profile.theme ?? null,
		created_at: timestamp,
		updated_at: timestamp,
	});
};

export const seedProfileFilter = async (ctx: TestContext, profileId: string, filter: ProfileFilterSeed): Promise<string> => {
	const timestamp = now();
	const filterId = uuid();
	await ctx.drizzle.insert(schema.profileFilters).values({
		id: filterId,
		profile_id: profileId,
		account_id: filter.account_id,
		filter_type: filter.filter_type,
		filter_key: filter.filter_key,
		filter_value: filter.filter_value,
		created_at: timestamp,
		updated_at: timestamp,
	});
	return filterId;
};

export const seedUserWithProfile = async (ctx: TestContext, user: UserSeed, profile: ProfileSeed): Promise<void> => {
	await seedUser(ctx, user);
	await seedProfile(ctx, user.id, profile);
};

export const getUser = async (ctx: TestContext, userId: string) => {
	return ctx.drizzle.select().from(schema.users).where(sql`${schema.users.id} = ${userId}`).get();
};

export const getAccount = async (ctx: TestContext, accountId: string) => {
	return ctx.drizzle.select().from(schema.accounts).where(sql`${schema.accounts.id} = ${accountId}`).get();
};

export const getRateLimit = async (ctx: TestContext, accountId: string) => {
	return ctx.drizzle.select().from(schema.rateLimits).where(sql`${schema.rateLimits.account_id} = ${accountId}`).get();
};

export const getUserAccounts = async (ctx: TestContext, userId: string) => {
	return ctx.drizzle.select().from(schema.accounts).innerJoin(schema.profiles, sql`${schema.accounts.profile_id} = ${schema.profiles.id}`).where(sql`${schema.profiles.user_id} = ${userId}`).all();
};

export const getProfileAccounts = async (ctx: TestContext, profileId: string) => {
	return ctx.drizzle.select().from(schema.accounts).where(sql`${schema.accounts.profile_id} = ${profileId}`).all();
};

export { hash_api_key };
