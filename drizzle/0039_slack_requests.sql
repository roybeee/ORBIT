CREATE TABLE `orbit_slack_requests` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`receipt_key` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_ts` text NOT NULL,
	`thread_ts` text DEFAULT '' NOT NULL,
	`event_id` text DEFAULT '' NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`reason_kind` text DEFAULT '' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`hold_id` text DEFAULT '' NOT NULL,
	`next_check_at` integer DEFAULT 0 NOT NULL,
	`turn_id` text DEFAULT '' NOT NULL,
	`conversation_id` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`deliveries` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orbit_slack_requests_receipt` ON `orbit_slack_requests` (`owner_id`,`receipt_key`);--> statement-breakpoint
CREATE INDEX `idx_orbit_slack_requests_status` ON `orbit_slack_requests` (`owner_id`,`status`);