CREATE TABLE `orbit_answer_feedback` (
	`owner_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`question` text NOT NULL,
	`project_id` text,
	`sources_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `turn_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_feedback_recent` ON `orbit_answer_feedback` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `orbit_plaud_imports` (
	`owner_id` text NOT NULL,
	`external_id` text NOT NULL,
	`hash` text NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `external_id`)
);
--> statement-breakpoint
CREATE TABLE `orbit_plaud_sync` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
