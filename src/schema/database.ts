import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type Platform = "github" | "bluesky" | "youtube" | "devpad";

export const users = sqliteTable("users", {
	id: text("id").primaryKey(),
	email: text("email").unique(),
	name: text("name"),
	created_at: text("created_at").notNull(),
	updated_at: text("updated_at").notNull(),
});

export const accounts = sqliteTable(
	"accounts",
	{
		id: text("id").primaryKey(),
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
		platform_user_idx: index("idx_accounts_platform_user").on(table.platform, table.platform_user_id),
	})
);

export const accountMembers = sqliteTable(
	"account_members",
	{
		id: text("id").primaryKey(),
		user_id: text("user_id")
			.notNull()
			.references(() => users.id),
		account_id: text("account_id")
			.notNull()
			.references(() => accounts.id),
		role: text("role").notNull().$type<"owner" | "member">(),
		created_at: text("created_at").notNull(),
	},
	table => ({
		user_account_idx: uniqueIndex("idx_user_account").on(table.user_id, table.account_id),
		user_idx: index("idx_account_members_user").on(table.user_id),
		account_idx: index("idx_account_members_account").on(table.account_id),
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
