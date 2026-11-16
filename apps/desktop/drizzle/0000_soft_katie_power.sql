CREATE TABLE `app_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`app_version` text NOT NULL,
	`platform` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`json` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "settings_single_row" CHECK("settings"."id" = 1)
);
