CREATE TABLE `media_platform_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`platform` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret_encrypted` text NOT NULL,
	`redirect_uri` text,
	`metadata` text,
	`is_verified` integer DEFAULT false,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `media_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_platform_credentials_unique` ON `media_platform_credentials` (`profile_id`,`platform`);--> statement-breakpoint
CREATE INDEX `idx_platform_credentials_profile` ON `media_platform_credentials` (`profile_id`);
