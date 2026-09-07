CREATE TABLE `orbit_reviews` (
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`review_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `date`)
);
