CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`content_version` text NOT NULL,
	`version` text NOT NULL,
	`mode` text NOT NULL,
	`scope` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`deadline_at` text,
	`time_limit_min` integer,
	`accommodations` text NOT NULL,
	`submitted_at` text,
	`submit_reason` text,
	`active_ms` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_scores` (
	`attempt_id` text NOT NULL,
	`item_id` text NOT NULL,
	`points` integer,
	`source` text NOT NULL,
	`auto_result` text,
	`data` text,
	`graded_at` text NOT NULL,
	PRIMARY KEY(`attempt_id`, `item_id`),
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `responses` (
	`attempt_id` text NOT NULL,
	`item_id` text NOT NULL,
	`value` text,
	`flagged` integer DEFAULT false NOT NULL,
	`hints_used` integer DEFAULT 0 NOT NULL,
	`time_spent_ms` integer DEFAULT 0 NOT NULL,
	`checked_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`attempt_id`, `item_id`),
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
