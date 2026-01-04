-- Create proper corpus tables for the @f0rbit/corpus library
-- These tables use the exact schema expected by corpus v0.2.2

CREATE TABLE IF NOT EXISTS `corpus_snapshots` (
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
	PRIMARY KEY (`store_id`, `version`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_store_created` ON `corpus_snapshots` (`store_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_content_hash` ON `corpus_snapshots` (`store_id`, `content_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_data_key` ON `corpus_snapshots` (`data_key`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `corpus_parents` (
	`child_store_id` text NOT NULL,
	`child_version` text NOT NULL,
	`parent_store_id` text NOT NULL,
	`parent_version` text NOT NULL,
	`role` text,
	PRIMARY KEY (`child_store_id`, `child_version`, `parent_store_id`, `parent_version`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_corpus_parents_child` ON `corpus_parents` (`child_store_id`, `child_version`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_corpus_parents_parent` ON `corpus_parents` (`parent_store_id`, `parent_version`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `corpus_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`source_store_id` text NOT NULL,
	`source_version` text NOT NULL,
	`model` text,
	`result` text NOT NULL,
	`observed_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_corpus_observations_source` ON `corpus_observations` (`source_store_id`, `source_version`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_corpus_observations_type` ON `corpus_observations` (`type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_corpus_observations_created` ON `corpus_observations` (`created_at`);
