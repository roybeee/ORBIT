CREATE TABLE `orbit_brief_parts` (
	`owner_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`generation` text NOT NULL,
	`stage` integer NOT NULL,
	`part` integer NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`owner_id`, `turn_id`, `generation`, `stage`, `part`)
);
