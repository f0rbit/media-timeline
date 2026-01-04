ALTER TABLE `media_corpus_snapshots` RENAME TO `corpus_snapshots`;--> statement-breakpoint
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
CREATE INDEX `idx_platform_credentials_profile` ON `media_platform_credentials` (`profile_id`);--> statement-breakpoint
DROP TABLE `media_corpus_parents`;--> statement-breakpoint
DROP INDEX `media_corpus_snapshots_pk`;--> statement-breakpoint
DROP INDEX `idx_media_corpus_snapshots_store`;--> statement-breakpoint
DROP INDEX `idx_media_corpus_snapshots_created`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_corpus_snapshots` (
	`store_id` text NOT NULL,
	`version` text NOT NULL,
	`parents` text NOT NULL,
	`created_at` text NOT NULL,
	`invoked_at` text,
	`content_hash` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`data_key` text NOT NULL,
	`tags` text,
	PRIMARY KEY(`store_id`, `version`)
);
--> statement-breakpoint
INSERT INTO `__new_corpus_snapshots`("store_id", "version", "parents", "created_at", "invoked_at", "content_hash", "content_type", "size_bytes", "data_key", "tags") SELECT "store_id", "version", "parents", "created_at", "invoked_at", "content_hash", "content_type", "size_bytes", "data_key", "tags" FROM `corpus_snapshots`;--> statement-breakpoint
DROP TABLE `corpus_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_corpus_snapshots` RENAME TO `corpus_snapshots`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_store_created` ON `corpus_snapshots` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_content_hash` ON `corpus_snapshots` (`store_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_data_key` ON `corpus_snapshots` (`data_key`);