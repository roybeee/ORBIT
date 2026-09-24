CREATE TABLE `orbit_gotem_sends` (
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`slot` text NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `date`, `slot`)
);
