CREATE TABLE `orbit_order_reads` (
	`owner_id` text NOT NULL,
	`order_id` text NOT NULL,
	`id` text NOT NULL,
	`tool` text NOT NULL,
	`args_json` text NOT NULL,
	`object_key` text NOT NULL,
	`chars` integer NOT NULL,
	`read_until` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `order_id`, `id`)
);
