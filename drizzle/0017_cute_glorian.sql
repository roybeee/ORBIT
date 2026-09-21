CREATE TABLE `orbit_event_reviews` (
	`owner_id` text NOT NULL,
	`review_id` text NOT NULL,
	`event_id` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`requested_at` text NOT NULL,
	`resolved_at` text,
	`follow_up_at` text,
	`next_task_id` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `review_id`),
	CONSTRAINT "orbit_event_review_state_check" CHECK("orbit_event_reviews"."state" in ('pending','completed','deferred','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_event_review_queue` ON `orbit_event_reviews` (`owner_id`,`state`,`follow_up_at`,`requested_at`);