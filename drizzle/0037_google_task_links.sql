CREATE TABLE `orbit_google_task_links` (
	`owner_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_list_id` text NOT NULL,
	`google_task_id` text NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `task_id`)
);
