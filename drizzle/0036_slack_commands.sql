CREATE TABLE `orbit_slack_commands` (
	`owner_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`operation_key` text NOT NULL,
	`id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`target_id` text,
	`candidates_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `workspace_id`, `requester_id`, `operation_key`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_slack_command_id` ON `orbit_slack_commands` (`id`);