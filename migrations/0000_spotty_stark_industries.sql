CREATE TABLE `media_account_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`setting_key` text NOT NULL,
	`setting_value` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `media_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_account_settings_unique` ON `media_account_settings` (`account_id`,`setting_key`);--> statement-breakpoint
CREATE INDEX `idx_media_account_settings_account` ON `media_account_settings` (`account_id`);--> statement-breakpoint
CREATE TABLE `media_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`platform` text NOT NULL,
	`platform_user_id` text,
	`platform_username` text,
	`access_token_encrypted` text NOT NULL,
	`refresh_token_encrypted` text,
	`token_expires_at` text,
	`is_active` integer DEFAULT true,
	`last_fetched_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `media_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_accounts_profile` ON `media_accounts` (`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_accounts_profile_platform_user` ON `media_accounts` (`profile_id`,`platform`,`platform_user_id`);--> statement-breakpoint
CREATE TABLE `media_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`name` text,
	`last_used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `media_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_api_keys_key_hash_unique` ON `media_api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_media_api_keys_user` ON `media_api_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `media_corpus_parents` (
	`child_store_id` text NOT NULL,
	`child_version` text NOT NULL,
	`parent_store_id` text NOT NULL,
	`parent_version` text NOT NULL,
	`role` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_corpus_parents_pk` ON `media_corpus_parents` (`child_store_id`,`child_version`,`parent_store_id`,`parent_version`);--> statement-breakpoint
CREATE TABLE `media_corpus_snapshots` (
	`store_id` text NOT NULL,
	`version` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`tags` text,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_corpus_snapshots_pk` ON `media_corpus_snapshots` (`store_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_media_corpus_snapshots_store` ON `media_corpus_snapshots` (`store_id`);--> statement-breakpoint
CREATE INDEX `idx_media_corpus_snapshots_created` ON `media_corpus_snapshots` (`store_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `media_profile_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`account_id` text NOT NULL,
	`filter_type` text NOT NULL,
	`filter_key` text NOT NULL,
	`filter_value` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `media_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `media_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_profile_filters_profile` ON `media_profile_filters` (`profile_id`);--> statement-breakpoint
CREATE INDEX `idx_media_profile_filters_account` ON `media_profile_filters` (`account_id`);--> statement-breakpoint
CREATE TABLE `media_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`theme` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `media_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_media_profiles_user` ON `media_profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_profiles_user_slug` ON `media_profiles` (`user_id`,`slug`);--> statement-breakpoint
CREATE TABLE `media_rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`remaining` integer,
	`limit_total` integer,
	`reset_at` text,
	`consecutive_failures` integer DEFAULT 0,
	`last_failure_at` text,
	`circuit_open_until` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `media_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_rate_limits_account` ON `media_rate_limits` (`account_id`);--> statement-breakpoint
CREATE TABLE `media_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`name` text,
	`devpad_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_users_email_unique` ON `media_users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_users_devpad_user_id` ON `media_users` (`devpad_user_id`);