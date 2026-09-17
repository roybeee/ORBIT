CREATE TABLE `orbit_data_trash` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`category` text NOT NULL,
	`record_id` text NOT NULL,
	`title` text NOT NULL,
	`payload_json` text NOT NULL,
	`deleted_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orbit_trash_record` ON `orbit_data_trash` (`owner_id`,`category`,`record_id`);--> statement-breakpoint
CREATE INDEX `idx_orbit_trash_recent` ON `orbit_data_trash` (`owner_id`,`deleted_at`,`id`);