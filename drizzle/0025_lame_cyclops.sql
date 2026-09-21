CREATE TABLE `orbit_calendar_edits` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`source_calendar_id` text NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
