CREATE TABLE `orbit_meeting_reviews` (
	`owner_id` text NOT NULL,
	`note_id` text NOT NULL,
	`revision` integer NOT NULL,
	`turn_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`status` text NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `note_id`, `revision`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_meeting_review_queue` ON `orbit_meeting_reviews` (`owner_id`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orbit_meeting_review_turn` ON `orbit_meeting_reviews` (`owner_id`,`turn_id`);