CREATE TABLE `account_members` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_account` ON `account_members` (`user_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `idx_account_members_user` ON `account_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_account_members_account` ON `account_members` (`account_id`);--> statement-breakpoint
CREATE TABLE `account_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`setting_key` text NOT NULL,
	`setting_value` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_account_settings_unique` ON `account_settings` (`account_id`,`setting_key`);--> statement-breakpoint
CREATE INDEX `idx_account_settings_account` ON `account_settings` (`account_id`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`platform_user_id` text,
	`platform_username` text,
	`access_token_encrypted` text NOT NULL,
	`refresh_token_encrypted` text,
	`token_expires_at` text,
	`is_active` integer DEFAULT true,
	`last_fetched_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_accounts_platform_user` ON `accounts` (`platform`,`platform_user_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`name` text,
	`last_used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_user` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `corpus_parents` (
	`child_store_id` text NOT NULL,
	`child_version` text NOT NULL,
	`parent_store_id` text NOT NULL,
	`parent_version` text NOT NULL,
	`role` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `corpus_parents_pk` ON `corpus_parents` (`child_store_id`,`child_version`,`parent_store_id`,`parent_version`);--> statement-breakpoint
CREATE TABLE `corpus_snapshots` (
	`store_id` text NOT NULL,
	`version` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`tags` text,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `corpus_snapshots_pk` ON `corpus_snapshots` (`store_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_corpus_snapshots_store` ON `corpus_snapshots` (`store_id`);--> statement-breakpoint
CREATE INDEX `idx_corpus_snapshots_created` ON `corpus_snapshots` (`store_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`remaining` integer,
	`limit_total` integer,
	`reset_at` text,
	`consecutive_failures` integer DEFAULT 0,
	`last_failure_at` text,
	`circuit_open_until` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rate_limits_account` ON `rate_limits` (`account_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`name` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);