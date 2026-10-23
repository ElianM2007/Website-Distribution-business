CREATE TABLE `account_events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'client' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "account_role_valid" CHECK("accounts"."role" IN ('staff','client')),
	CONSTRAINT "account_status_valid" CHECK("accounts"."status" IN ('pending','approved','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_unique` ON `accounts` (`email`);--> statement-breakpoint
CREATE TABLE `auth_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_rate_expiry` ON `auth_rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_key_unique` ON `categories` (`name_key`);--> statement-breakpoint
CREATE TABLE `owner_bootstrap` (
	`slot` integer PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "owner_singleton" CHECK("owner_bootstrap"."slot" = 1)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_account` ON `sessions` (`account_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry` ON `sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `orders` ADD `fulfillment_method` text DEFAULT 'delivery' NOT NULL;