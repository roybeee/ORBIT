CREATE TABLE `orbit_aside_jobs` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`status` text NOT NULL,
	`job_json` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_aside_recent` ON `orbit_aside_jobs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orbit_aside_active` ON `orbit_aside_jobs` (`owner_id`) WHERE "orbit_aside_jobs"."status" IN ('running','stop_requested','needs_attention');