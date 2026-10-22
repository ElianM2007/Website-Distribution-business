CREATE TABLE `order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`sku` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_item_quantity_valid" CHECK("order_items"."quantity" > 0 AND "order_items"."quantity" <= 10000),
	CONSTRAINT "order_item_price_valid" CHECK("order_items"."unit_price_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_item_product` ON `order_items` (`order_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`customer_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_cents` integer NOT NULL,
	`delivery_address` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`idempotency_key` text,
	`request_hash` text NOT NULL,
	CONSTRAINT "order_status_valid" CHECK("orders"."status" IN ('pending','confirmed','shipped','delivered','cancelled')),
	CONSTRAINT "order_total_valid" CHECK("orders"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_unique` ON `orders` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_customer_idempotency` ON `orders` (`customer_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `orders_customer_created` ON `orders` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_created` ON `orders` (`created_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`unit` text NOT NULL,
	`price_cents` integer NOT NULL,
	`stock` integer NOT NULL,
	`reorder_level` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "product_stock_valid" CHECK("products"."stock" >= 0 AND "products"."stock" <= 1000000000),
	CONSTRAINT "product_price_valid" CHECK("products"."price_cents" >= 0 AND "products"."price_cents" <= 100000000),
	CONSTRAINT "product_reorder_valid" CHECK("products"."reorder_level" >= 0),
	CONSTRAINT "product_active_valid" CHECK("products"."active" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`order_id` text,
	`actor_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `movements_product_created` ON `stock_movements` (`product_id`,`created_at`);