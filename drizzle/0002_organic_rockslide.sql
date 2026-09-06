CREATE TABLE `orbit_agent_actions` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`turn_id` text NOT NULL,
	`title` text NOT NULL,
	`reason` text NOT NULL,
	`action_json` text NOT NULL,
	`expected_revision` integer NOT NULL,
	`state` text NOT NULL,
	`note` text NOT NULL,
	`revisit_date` text,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_action_owner_state` ON `orbit_agent_actions` (`owner_id`,`state`);--> statement-breakpoint
CREATE TABLE `orbit_agent_turns` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_turn_owner_created` ON `orbit_agent_turns` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orbit_one_running_turn` ON `orbit_agent_turns` (`owner_id`) WHERE "orbit_agent_turns"."status" = 'running';--> statement-breakpoint
CREATE TABLE `orbit_calendar_cache` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`events_json` text NOT NULL,
	`time_zone` text NOT NULL,
	`range_start` text NOT NULL,
	`range_end` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orbit_integrations` (
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`secret_json` text NOT NULL,
	`public_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `provider`)
);
--> statement-breakpoint
CREATE TABLE `orbit_oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`secret_json` text NOT NULL,
	`expires_at` text NOT NULL
);
