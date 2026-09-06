CREATE TABLE `orbit_identity_links` (
	`email_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`conflicted` integer DEFAULT 0 NOT NULL
);
