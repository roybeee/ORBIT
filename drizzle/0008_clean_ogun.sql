CREATE TABLE `orbit_attachments` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`object_key` text,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`preview_key` text,
	`context_text` text DEFAULT '' NOT NULL,
	`context_label` text DEFAULT '원본 파일' NOT NULL,
	`target_type` text,
	`target_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_attachment_target` ON `orbit_attachments` (`owner_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_orbit_attachment_recent` ON `orbit_attachments` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `orbit_agent_turns` ADD `attachment_ids` text DEFAULT '[]' NOT NULL;