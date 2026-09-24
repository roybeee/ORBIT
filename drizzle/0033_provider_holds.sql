CREATE TABLE `orbit_provider_holds` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`opened_at` text NOT NULL,
	`next_check_at` integer NOT NULL,
	`retry_known` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`probe_turn_id` text DEFAULT '' NOT NULL,
	`probe_until` integer DEFAULT 0 NOT NULL,
	`probes` integer DEFAULT 0 NOT NULL,
	`leaked` integer DEFAULT 0 NOT NULL,
	`manual` integer DEFAULT 0 NOT NULL,
	`cleared_at` text,
	`cleared_by` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_provider_holds_active` ON `orbit_provider_holds` (`owner_id`,`provider`,`cleared_at`);--> statement-breakpoint
ALTER TABLE `orbit_meeting_reviews` ADD `hold_id` text DEFAULT '' NOT NULL;