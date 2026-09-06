CREATE TABLE `orbit_note_revisions` (
	`owner_id` text NOT NULL,
	`note_id` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`note_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `note_id`, `revision`)
);
