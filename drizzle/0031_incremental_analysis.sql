CREATE TABLE `orbit_analysis_cache` (
	`owner_id` text NOT NULL,
	`cache_key` text NOT NULL,
	`version` text NOT NULL,
	`stage` text NOT NULL,
	`unit` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `cache_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_analysis_cache_used` ON `orbit_analysis_cache` (`owner_id`,`last_used_at`);--> statement-breakpoint
CREATE TABLE `orbit_brief_runs` (
	`owner_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`date` text NOT NULL,
	`started_at` text NOT NULL,
	`basis_at` text NOT NULL,
	`ready_at` text,
	`source_revision` integer DEFAULT 0 NOT NULL,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`manifest_json` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `turn_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_brief_runs_date` ON `orbit_brief_runs` (`owner_id`,`date`,`started_at`);