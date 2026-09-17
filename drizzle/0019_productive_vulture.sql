CREATE TABLE `orbit_activity_messages` (
	`owner_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`session_id` text NOT NULL,
	`id` text NOT NULL,
	`record_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_calls` text NOT NULL,
	`timestamp` text NOT NULL,
	PRIMARY KEY(`owner_id`, `connection_id`, `session_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_activity_messages_record` ON `orbit_activity_messages` (`owner_id`,`record_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `orbit_activity_sessions` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`connection_id` text NOT NULL,
	`session_id` text NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`project_id` text,
	`category` text NOT NULL,
	`manual` integer DEFAULT 0 NOT NULL,
	`summary` text NOT NULL,
	`metadata_json` text NOT NULL,
	`message_offset` integer DEFAULT 0 NOT NULL,
	`signature` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_activity_recent` ON `orbit_activity_sessions` (`owner_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_orbit_activity_project` ON `orbit_activity_sessions` (`owner_id`,`project_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `orbit_activity_sync` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
