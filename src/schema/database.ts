import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type Platform = "github" | "bluesky" | "youtube" | "devpad" | "reddit" | "twitter";

export const users = sqliteTable(
	"users",
	{
		id: text("id").primaryKey(),
		email: text("email").unique(),
		name: text("name"),
		devpad_user_id: text("devpad_user_id"),
		created_at: text("created_at").notNull(),
		updated_at: text("updated_at").notNull(),
	},
	table => ({
		devpad_user_idx: uniqueIndex("idx_users_devpad_user_id").on(table.devpad_user_id),
	})
);

export const profiles = sqliteTable(
	"profiles",
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
		user_idx: index("idx_profiles_user").on(table.user_id),
		user_slug_idx: uniqueIndex("idx_profiles_user_slug").on(table.user_id, table.slug),
	})
);

export const accounts = sqliteTable(
	"accounts",
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
		profile_idx: index("idx_accounts_profile").on(table.profile_id),
		profile_platform_user_idx: uniqueIndex("idx_accounts_profile_platform_user").on(table.profile_id, table.platform, table.platform_user_id),
	})
);

export const apiKeys = sqliteTable(
	"api_keys",
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
		user_idx: index("idx_api_keys_user").on(table.user_id),
	})
);

export const rateLimits = sqliteTable(
	"rate_limits",
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
		account_idx: uniqueIndex("idx_rate_limits_account").on(table.account_id),
	})
);

export const accountSettings = sqliteTable(
	"account_settings",
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
		account_key_idx: uniqueIndex("idx_account_settings_unique").on(table.account_id, table.setting_key),
		account_idx: index("idx_account_settings_account").on(table.account_id),
	})
);

export const corpusSnapshots = sqliteTable(
	"corpus_snapshots",
	{
		store_id: text("store_id").notNull(),
		version: text("version").notNull(),
		content_hash: text("content_hash").notNull(),
		created_at: text("created_at").notNull(),
		tags: text("tags"),
		metadata: text("metadata"),
	},
	table => ({
		pk: uniqueIndex("corpus_snapshots_pk").on(table.store_id, table.version),
		store_idx: index("idx_corpus_snapshots_store").on(table.store_id),
		created_idx: index("idx_corpus_snapshots_created").on(table.store_id, table.created_at),
	})
);

export const corpusParents = sqliteTable(
	"corpus_parents",
	{
		child_store_id: text("child_store_id").notNull(),
		child_version: text("child_version").notNull(),
		parent_store_id: text("parent_store_id").notNull(),
		parent_version: text("parent_version").notNull(),
		role: text("role"),
	},
	table => ({
		pk: uniqueIndex("corpus_parents_pk").on(table.child_store_id, table.child_version, table.parent_store_id, table.parent_version),
	})
);

export const profileFilters = sqliteTable(
	"profile_filters",
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
		profile_idx: index("idx_profile_filters_profile").on(table.profile_id),
		account_idx: index("idx_profile_filters_account").on(table.account_id),
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
