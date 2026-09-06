CREATE TABLE `orbit_hermes_jobs` (
	`owner_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`turn_lease` text NOT NULL,
	`job_json` text NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `turn_id`)
);
