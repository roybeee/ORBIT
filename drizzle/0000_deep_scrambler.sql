CREATE TABLE `orbit_mutations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`action_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `orbit_workspaces` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL,
	`mutation_id` text NOT NULL,
	`updated_at` text NOT NULL
);
