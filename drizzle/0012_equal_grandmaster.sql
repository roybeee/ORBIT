CREATE TABLE `orbit_chief_jobs` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL
);
