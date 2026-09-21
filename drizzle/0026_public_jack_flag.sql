CREATE TABLE `orbit_workspace_chunks` (
	`owner_id` text NOT NULL,
	`generation` text NOT NULL,
	`part` integer NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`owner_id`, `part`)
);
--> statement-breakpoint
CREATE TABLE `orbit_workspace_projects` (
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `project_id`)
);
