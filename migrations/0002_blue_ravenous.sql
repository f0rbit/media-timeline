CREATE TABLE `profile_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`account_id` text NOT NULL,
	`filter_type` text NOT NULL,
	`filter_key` text NOT NULL,
	`filter_value` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_profile_filters_profile` ON `profile_filters` (`profile_id`);--> statement-breakpoint
CREATE INDEX `idx_profile_filters_account` ON `profile_filters` (`account_id`);--> statement-breakpoint
CREATE TABLE `profile_visibility` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`account_id` text NOT NULL,
	`is_visible` integer DEFAULT true,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_profile_visibility_profile` ON `profile_visibility` (`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_profile_visibility_unique` ON `profile_visibility` (`profile_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`theme` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_profiles_user` ON `profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_profiles_user_slug` ON `profiles` (`user_id`,`slug`);