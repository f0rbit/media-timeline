import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Platform } from "./platforms";

export { corpus_snapshots } from "@f0rbit/corpus/schema";

export const users = sqliteTable("media_users", {
	id: text("id").primaryKey(),
	email: text("email").unique(),
	name: text("name"),
	created_at: text("created_at").notNull(),
	updated_at: text("updated_at").notNull(),
});

export const profiles = sqliteTable(
	"media_profiles",
	{
		id: text("id").primaryKey(),
		user_id: text("user_id")
			.notNull()
			.references(() => users.id),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		theme: text("theme"),
		created_at: text("created_at").notNull(),
		updated_at: text("updated_at").notNull(),
	},
	table => ({
		user_idx: index("idx_media_profiles_user").on(table.user_id),
		user_slug_idx: uniqueIndex("idx_media_profiles_user_slug").on(table.user_id, table.slug),
	})
);

export const accounts = sqliteTable(
	"media_accounts",
	{
		id: text("id").primaryKey(),
		profile_id: text("profile_id")
			.notNull()
			.references(() => profiles.id, { onDelete: "cascade" }),
		platform: text("platform").notNull().$type<Platform>(),
		platform_user_id: text("platform_user_id"),
		platform_username: text("platform_username"),
		access_token_encrypted: text("access_token_encrypted").notNull(),
		refresh_token_encrypted: text("refresh_token_encrypted"),
		token_expires_at: text("token_expires_at"),
		is_active: integer("is_active", { mode: "boolean" }).default(true),
		last_fetched_at: text("last_fetched_at"),
		created_at: text("created_at").notNull(),
		updated_at: text("updated_at").notNull(),
	},
	table => ({
		profile_idx: index("idx_media_accounts_profile").on(table.profile_id),
		profile_platform_user_idx: uniqueIndex("idx_media_accounts_profile_platform_user").on(table.profile_id, table.platform, table.platform_user_id),
	})
);

export const apiKeys = sqliteTable(
	"media_api_keys",
	{
		id: text("id").primaryKey(),
		user_id: text("user_id")
			.notNull()
			.references(() => users.id),
		key_hash: text("key_hash").notNull().unique(),
		name: text("name"),
		last_used_at: text("last_used_at"),
		created_at: text("created_at").notNull(),
	},
	table => ({
		user_idx: index("idx_media_api_keys_user").on(table.user_id),
	})
);

export const rateLimits = sqliteTable(
	"media_rate_limits",
	{
		id: text("id").primaryKey(),
		account_id: text("account_id")
			.notNull()
			.references(() => accounts.id),
		remaining: integer("remaining"),
		limit_total: integer("limit_total"),
		reset_at: text("reset_at"),
		consecutive_failures: integer("consecutive_failures").default(0),
		last_failure_at: text("last_failure_at"),
		circuit_open_until: text("circuit_open_until"),
		updated_at: text("updated_at").notNull(),
	},
	table => ({
		account_idx: uniqueIndex("idx_media_rate_limits_account").on(table.account_id),
	})
);

export const accountSettings = sqliteTable(
	"media_account_settings",
	{
		id: text("id").primaryKey(),
		account_id: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "cascade" }),
		setting_key: text("setting_key").notNull(),
		setting_value: text("setting_value").notNull(),
		created_at: text("created_at").notNull(),
		updated_at: text("updated_at").notNull(),
	},
	table => ({
		account_key_idx: uniqueIndex("idx_media_account_settings_unique").on(table.account_id, table.setting_key),
		account_idx: index("idx_media_account_settings_account").on(table.account_id),
	})
);

export const profileFilters = sqliteTable(
	"media_profile_filters",
	{
		id: text("id").primaryKey(),
		profile_id: text("profile_id")
			.notNull()
			.references(() => profiles.id, { onDelete: "cascade" }),
		account_id: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "cascade" }),
		filter_type: text("filter_type").notNull().$type<"include" | "exclude">(),
		filter_key: text("filter_key").notNull(),
		filter_value: text("filter_value").notNull(),
		created_at: text("created_at").notNull(),
		updated_at: text("updated_at").notNull(),
	},
	table => ({
		profile_idx: index("idx_media_profile_filters_profile").on(table.profile_id),
		account_idx: index("idx_media_profile_filters_account").on(table.account_id),
	})
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type RateLimit = typeof rateLimits.$inferSelect;
export type NewRateLimit = typeof rateLimits.$inferInsert;
export type AccountSetting = typeof accountSettings.$inferSelect;
export type NewAccountSetting = typeof accountSettings.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type ProfileFilter = typeof profileFilters.$inferSelect;
export type NewProfileFilter = typeof profileFilters.$inferInsert;

export const platformCredentials = sqliteTable(
	"media_platform_credentials",
	{
		id: text("id").primaryKey(),
		profile_id: text("profile_id")
			.notNull()
			.references(() => profiles.id, { onDelete: "cascade" }),
		platform: text("platform").notNull().$type<Platform>(),
		client_id: text("client_id").notNull(),
		client_secret_encrypted: text("client_secret_encrypted").notNull(),
		redirect_uri: text("redirect_uri"),
		metadata: text("metadata"),
		is_verified: integer("is_verified", { mode: "boolean" }).default(false),
		created_at: text("created_at").notNull(),
		updated_at: text("updated_at").notNull(),
	},
	table => ({
		profile_platform_idx: uniqueIndex("idx_platform_credentials_unique").on(table.profile_id, table.platform),
		profile_idx: index("idx_platform_credentials_profile").on(table.profile_id),
	})
);

export type PlatformCredential = typeof platformCredentials.$inferSelect;
export type NewPlatformCredential = typeof platformCredentials.$inferInsert;
