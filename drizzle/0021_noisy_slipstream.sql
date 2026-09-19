CREATE TABLE `orbit_discord_commands` (
	`owner_id` text NOT NULL,
	`message_id` text NOT NULL,
	`command_json` text NOT NULL,
	`status` text NOT NULL,
	`response` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `message_id`)
);
--> statement-breakpoint
CREATE TABLE `orbit_discord_outbox` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`channel_id` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_discord_pending` ON `orbit_discord_outbox` (`owner_id`,`status`,`next_at`);--> statement-breakpoint
CREATE TABLE `orbit_discord_state` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
