CREATE TABLE `orbit_conversations` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`project_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_conversation_recent` ON `orbit_conversations` (`owner_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_orbit_conversation_project` ON `orbit_conversations` (`owner_id`,`project_id`,`updated_at`,`id`);--> statement-breakpoint
ALTER TABLE `orbit_agent_turns` ADD `conversation_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_orbit_turn_conversation_created` ON `orbit_agent_turns` (`owner_id`,`conversation_id`,`created_at`,`id`);