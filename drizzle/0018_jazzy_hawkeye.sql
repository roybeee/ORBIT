CREATE TABLE `orbit_calendar_exports` (
	`owner_id` text NOT NULL,
	`event_id` text NOT NULL,
	`state_json` text NOT NULL,
	PRIMARY KEY(`owner_id`, `event_id`)
);
--> statement-breakpoint
CREATE TABLE `orbit_calendar_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`selected_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orbit_daily_runs` (
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `date`)
);
--> statement-breakpoint
CREATE TABLE `orbit_daily_runtime` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`config_json` text NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`last_tick` text
);
--> statement-breakpoint
CREATE TABLE `orbit_order_reviews` (
	`owner_id` text NOT NULL,
	`order_id` text NOT NULL,
	`review_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `order_id`)
);
--> statement-breakpoint
CREATE TABLE `orbit_source_status` (
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`state_json` text NOT NULL,
	PRIMARY KEY(`owner_id`, `provider`)
);
