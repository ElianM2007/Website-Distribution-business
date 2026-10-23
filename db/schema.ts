import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, check, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: text("id").primaryKey(), sku: text("sku").notNull().unique(),
  name: text("name").notNull(), category: text("category").notNull(), unit: text("unit").notNull(),
  priceCents: integer("price_cents").notNull(), stock: integer("stock").notNull(),
  reorderLevel: integer("reorder_level").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull(),
}, (t) => [check("product_stock_valid", sql`${t.stock} >= 0 AND ${t.stock} <= 1000000000`),
  check("product_price_valid", sql`${t.priceCents} >= 0 AND ${t.priceCents} <= 100000000`),
  check("product_reorder_valid", sql`${t.reorderLevel} >= 0`),
  check("product_active_valid", sql`${t.active} IN (0,1)`)]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(), number: text("number").notNull().unique(), customerId: text("customer_id").notNull(),
  customerName: text("customer_name").notNull(), customerEmail: text("customer_email").notNull(),
  status: text("status").notNull().default("pending"), totalCents: integer("total_cents").notNull(),
  deliveryAddress: text("delivery_address").notNull(), notes: text("notes").notNull().default(""),
  fulfillmentMethod: text("fulfillment_method").notNull().default("delivery"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
  idempotencyKey: text("idempotency_key"), requestHash: text("request_hash").notNull(),
}, (t) => [check("order_status_valid", sql`${t.status} IN ('pending','confirmed','shipped','delivered','cancelled')`),
  check("order_total_valid", sql`${t.totalCents} >= 0`),
  uniqueIndex("orders_customer_idempotency").on(t.customerId, t.idempotencyKey),
  index("orders_customer_created").on(t.customerId,t.createdAt),index("orders_created").on(t.createdAt)]);

export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(), orderId: text("order_id").notNull().references(() => orders.id),
  productId: text("product_id").notNull().references(() => products.id), name: text("name").notNull(),
  sku: text("sku").notNull(), quantity: integer("quantity").notNull(), unitPriceCents: integer("unit_price_cents").notNull(),
}, (t) => [check("order_item_quantity_valid", sql`${t.quantity} > 0 AND ${t.quantity} <= 10000`),
  check("order_item_price_valid", sql`${t.unitPriceCents} >= 0`), uniqueIndex("order_item_product").on(t.orderId,t.productId)]);

export const stockMovements = sqliteTable("stock_movements", {
  id: text("id").primaryKey(), productId: text("product_id").notNull().references(() => products.id),
  orderId: text("order_id").references(() => orders.id), actorId: text("actor_id").notNull(),
  delta: integer("delta").notNull(), reason: text("reason").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [index("movements_product_created").on(t.productId,t.createdAt)]);

export const orderEvents = sqliteTable("order_events", {
  id: text("id").primaryKey(), orderId: text("order_id").notNull().references(() => orders.id),
  actorId: text("actor_id").notNull(), fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(), createdAt: text("created_at").notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(), role: text("role").notNull().default("client"),
  status: text("status").notNull().default("pending"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [check("account_role_valid",sql`${t.role} IN ('staff','client')`),check("account_status_valid",sql`${t.status} IN ('pending','approved','rejected')`)]);
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(), accountId: text("account_id").notNull().references(() => accounts.id),
  expiresAt: integer("expires_at").notNull(), createdAt: text("created_at").notNull(),
}, t => [index("sessions_account").on(t.accountId),index("sessions_expiry").on(t.expiresAt)]);
export const authRateLimits = sqliteTable("auth_rate_limits", {
  key: text("key").primaryKey(), count: integer("count").notNull(), expiresAt: integer("expires_at").notNull(),
}, t => [index("auth_rate_expiry").on(t.expiresAt)]);
export const ownerBootstrap = sqliteTable("owner_bootstrap", {
  slot: integer("slot").primaryKey(), accountId: text("account_id").notNull().references(() => accounts.id),
}, t => [check("owner_singleton",sql`${t.slot} = 1`)]);
export const accountEvents = sqliteTable("account_events", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull().references(() => accounts.id),
  actorId: text("actor_id").notNull().references(() => accounts.id), status: text("status").notNull(), createdAt: text("created_at").notNull(),
});
export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(), name: text("name").notNull(), nameKey: text("name_key").notNull().unique(), createdAt: text("created_at").notNull(),
});
