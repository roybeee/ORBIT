CREATE TABLE `orbit_agent_orders` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`connection_id` text NOT NULL,
	`request_json` text NOT NULL,
	`state_json` text NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`stop_requested` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_orders_recent` ON `orbit_agent_orders` (`owner_id`,`created_at`,`id`);