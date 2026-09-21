CREATE TABLE `orbit_project_relations` (
	`owner_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source_provider` text NOT NULL,
	`source_id` text,
	`source_date` text,
	`resolution` text NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `entity_type`, `entity_id`),
	CONSTRAINT "orbit_project_relation_entity_type_check" CHECK("orbit_project_relations"."entity_type" in ('event','task','note','meeting','document')),
	CONSTRAINT "orbit_project_relation_resolution_check" CHECK("orbit_project_relations"."resolution" in ('explicit','alias','existing','backfill'))
);
--> statement-breakpoint
CREATE INDEX `idx_orbit_project_timeline` ON `orbit_project_relations` (`owner_id`,`project_id`,`source_date`,`entity_type`,`entity_id`);