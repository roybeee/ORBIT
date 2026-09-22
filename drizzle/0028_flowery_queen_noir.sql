CREATE TABLE `orbit_notification_state` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`public_key` text DEFAULT '' NOT NULL,
	`private_key` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orbit_notifications` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`href` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_notifications_recent` ON `orbit_notifications` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orbit_notifications_unread` ON `orbit_notifications` (`owner_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `orbit_push_deliveries` (
	`owner_id` text NOT NULL,
	`notification_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`owner_id`, `notification_id`, `subscription_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_push_queue` ON `orbit_push_deliveries` (`owner_id`,`status`,`next_at`);--> statement-breakpoint
CREATE TABLE `orbit_push_subscriptions` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`subscription_json` text NOT NULL,
	`created_at` text NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
ALTER TABLE `orbit_meeting_reviews` ADD `summary` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orbit_meeting_reviews` ADD `engine_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `orbit_meeting_reviews` ADD `attempts` integer DEFAULT 0 NOT NULL;