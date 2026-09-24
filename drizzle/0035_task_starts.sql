CREATE TABLE `orbit_task_starts` (
	`owner_id` text NOT NULL,
	`task_id` text NOT NULL,
	`started_at` text NOT NULL,
	`date` text NOT NULL,
	PRIMARY KEY(`owner_id`, `task_id`, `started_at`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_task_starts_date` ON `orbit_task_starts` (`owner_id`,`date`);