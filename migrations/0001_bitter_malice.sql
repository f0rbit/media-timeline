ALTER TABLE `users` ADD `devpad_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_devpad_user_id` ON `users` (`devpad_user_id`);