CREATE TABLE `orbit_slack_credentials` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orbit_slack_directives` (
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
	PRIMARY KEY(`owner_id`, `workspace_id`, `requester_id`, `operation_key`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_slack_receipt_id` ON `orbit_slack_directives` (`id`);