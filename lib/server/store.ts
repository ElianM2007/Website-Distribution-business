import type { z } from "zod";
import { ApiError } from "./errors";
import { canTransition, createOrderSchema, createProductSchema, patchProductSchema } from "./validation";

type User = { id: string; name: string; email: string; role: "staff" | "client" };
type ProductRow = { id: string; sku: string; name: string; category: string; unit: string; price_cents: number; stock: number; reorder_level: number; active: number; updated_at: string };
type OrderRow = { id: string; number: string; customer_id: string; customer_name: string; customer_email: string; status: string; total_cents: number; created_at: string; delivery_address: string; notes: string; request_hash: string };
type ItemRow = { product_id: string; name: string; sku: string; quantity: number; unit_price_cents: number; order_id: string };
export const productView = (p: ProductRow) => ({ id:p.id, sku:p.sku, name:p.name, category:p.category, unit:p.unit, priceCents:p.price_cents, stock:p.stock, reorderLevel:p.reorder_level, active:!!p.active, updatedAt:p.updated_at });
const orderView = (o: OrderRow, items: ItemRow[]) => ({ id:o.id, number:o.number, customerName:o.customer_name, customerEmail:o.customer_email, status:o.status, totalCents:o.total_cents, createdAt:o.created_at, deliveryAddress:o.delivery_address, notes:o.notes, items:items.map(i => ({productId:i.product_id,name:i.name,sku:i.sku,quantity:i.quantity,unitPriceCents:i.unit_price_cents})) });
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const constraintError = (error: unknown) => /constraint|unique|stock_valid|status_valid/i.test(String(error));

export async function listProducts(db: D1Database, staff: boolean, limit = 1000, offset = 0) {
  const result = await db.prepare("SELECT * FROM products WHERE (? = 1 OR active = 1) ORDER BY name, id LIMIT ? OFFSET ?").bind(staff ? 1 : 0,limit,offset).all<ProductRow>();
  return result.results.map(productView);
}
export async function getProduct(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<ProductRow>();
  if (!row) throw new ApiError(404,"Product not found.");
  return row;
}
export async function createProduct(db: D1Database, input: z.infer<typeof createProductSchema>, actorId: string) {
  const id = uid(), timestamp = now();
  try {
    await db.batch([
      db.prepare("INSERT INTO products (id,sku,name,category,unit,price_cents,stock,reorder_level,active,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(id,input.sku,input.name,input.category,input.unit,input.priceCents,input.stock,input.reorderLevel,input.active === false ? 0 : 1,timestamp),
      db.prepare("INSERT INTO stock_movements (id,product_id,actor_id,delta,reason,created_at) VALUES (?,?,?,?,?,?)")
        .bind(uid(),id,actorId,input.stock,"Opening inventory",timestamp),
    ]);
  } catch (error) { if (constraintError(error)) throw new ApiError(409,"A product with this SKU already exists, or the inventory values are invalid."); throw error; }
  return productView(await getProduct(db,id));
}
export async function updateProduct(db: D1Database, id: string, input: z.infer<typeof patchProductSchema>) {
  // Only fixed, allowlisted SQL identifiers are interpolated; values are always bound.
  const columns = {sku:"sku",name:"name",category:"category",unit:"unit",priceCents:"price_cents",reorderLevel:"reorder_level",active:"active"} as const;
  const entries = Object.entries(input) as [keyof typeof columns,string | number | boolean][];
  if (!entries.length) throw new ApiError(400,"Provide at least one field.");
  await getProduct(db,id);
  try {
    await db.prepare(`UPDATE products SET ${entries.map(([key]) => `${columns[key]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...entries.map(([,value]) => typeof value === "boolean" ? Number(value) : value),now(),id).run();
  } catch (error) { if (constraintError(error)) throw new ApiError(409,"A product with this SKU already exists."); throw error; }
  return productView(await getProduct(db,id));
}
export async function adjustStock(db: D1Database, id: string, delta: number, reason: string, actorId: string) {
  await getProduct(db,id); const timestamp = now();
  try {
    await db.batch([
      db.prepare("UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?").bind(delta,timestamp,id),
      db.prepare("INSERT INTO stock_movements (id,product_id,actor_id,delta,reason,created_at) VALUES (?,?,?,?,?,?)").bind(uid(),id,actorId,delta,reason,timestamp),
    ]);
  } catch (error) { if (constraintError(error)) throw new ApiError(409,"This adjustment would put stock outside the allowed range."); throw error; }
  return productView(await getProduct(db,id));
}
async function hydrateOrders(db: D1Database, rows: OrderRow[]) {
  if (!rows.length) return [];
  const byOrder = new Map<string,ItemRow[]>();
  // D1 caps bound parameters; keep each read below the limit.
  for (let start = 0; start < rows.length; start += 80) {
    const ids = rows.slice(start,start+80).map(o => o.id);
    const items = await db.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY name`).bind(...ids).all<ItemRow>();
    for (const item of items.results) { const group = byOrder.get(item.order_id) ?? []; group.push(item); byOrder.set(item.order_id,group); }
  }
  return rows.map(row => orderView(row,byOrder.get(row.id) ?? []));
}
export async function listOrders(db: D1Database, user: User, limit = 500, offset = 0) {
  const rows = await db.prepare("SELECT * FROM orders WHERE (? = 1 OR customer_id = ?) ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").bind(user.role === "staff" ? 1 : 0,user.id,limit,offset).all<OrderRow>();
  return hydrateOrders(db,rows.results);
}
export async function getOrder(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first<OrderRow>();
  if (!row) throw new ApiError(404,"Order not found.");
  return row;
}
export async function createOrder(db: D1Database, user: User, input: z.infer<typeof createOrderSchema>, idempotencyKey: string | null) {
  const canonical = JSON.stringify({ ...input, notes: input.notes ?? "", items:[...input.items].sort((a,b) => a.productId.localeCompare(b.productId)) });
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical));
  const hash = Array.from(new Uint8Array(digest),b => b.toString(16).padStart(2,"0")).join("");
  async function replay() {
    if (!idempotencyKey) return null;
    const existing = await db.prepare("SELECT * FROM orders WHERE customer_id = ? AND idempotency_key = ?").bind(user.id,idempotencyKey).first<OrderRow>();
    if (!existing) return null;
    if (existing.request_hash !== hash) throw new ApiError(409,"This request key was already used for a different order.");
    return (await hydrateOrders(db,[existing]))[0];
  }
  const prior = await replay(); if (prior) return prior;
  const ids = input.items.map(i => i.productId);
  const rows = await db.prepare(`SELECT * FROM products WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<ProductRow>();
  const products = new Map(rows.results.map(p => [p.id,p]));
  let total = 0;
  for (const item of input.items) {
    const product = products.get(item.productId);
    if (!product?.active) throw new ApiError(409,"One or more products are no longer available.");
    if (product.stock < item.quantity) throw new ApiError(409,`Not enough stock for ${product.name}. Refresh your order and try again.`);
    total += product.price_cents * item.quantity;
  }
  if (!Number.isSafeInteger(total)) throw new ApiError(400,"Order total exceeds the supported amount.");
  const id = uid(), timestamp = now(), number = `RL-${id.replaceAll("-","").slice(0,12).toUpperCase()}`;
  const statements = [db.prepare("INSERT INTO orders (id,number,customer_id,customer_name,customer_email,status,total_cents,delivery_address,notes,created_at,updated_at,idempotency_key,request_hash) VALUES (?,?,?,?,?,'pending',?,?,?,?,?,?,?)")
    .bind(id,number,user.id,user.name,user.email,total,input.deliveryAddress,input.notes ?? "",timestamp,timestamp,idempotencyKey,hash)];
  for (const item of input.items) {
    const product = products.get(item.productId)!;
    // Failing this CHECK aborts the entire batch, including the order and every prior stock update.
    // Checking active + price in the UPDATE closes the race with archiving or repricing a product.
    statements.push(db.prepare("UPDATE products SET stock = CASE WHEN active = 1 AND price_cents = ? THEN stock - ? ELSE -1 END, updated_at = ? WHERE id = ?")
      .bind(product.price_cents,item.quantity,timestamp,product.id));
    statements.push(db.prepare("INSERT INTO order_items (id,order_id,product_id,name,sku,quantity,unit_price_cents) VALUES (?,?,?,?,?,?,?)")
      .bind(uid(),id,product.id,product.name,product.sku,item.quantity,product.price_cents));
    statements.push(db.prepare("INSERT INTO stock_movements (id,product_id,order_id,actor_id,delta,reason,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(uid(),product.id,id,user.id,-item.quantity,"Order reservation",timestamp));
  }
  try { await db.batch(statements); }
  catch (error) {
    const concurrentReplay = await replay(); if (concurrentReplay) return concurrentReplay;
    if (constraintError(error)) throw new ApiError(409,"Inventory or prices changed while placing this order. Refresh and try again.");
    throw error;
  }
  return (await hydrateOrders(db,[await getOrder(db,id)]))[0];
}
export async function updateOrderStatus(db: D1Database, id: string, status: string, actorId: string) {
  const order = await getOrder(db,id);
  if (order.status === status) return (await hydrateOrders(db,[order]))[0];
  if (!canTransition(order.status,status)) throw new ApiError(409,`An order cannot move from ${order.status} to ${status}.`);
  const timestamp = now();
  // The invalid sentinel deliberately trips the status CHECK on a concurrent transition.
  // A losing cancellation cannot execute any restock because D1 batch rolls it back.
  const statements = [db.prepare("UPDATE orders SET status = CASE WHEN status = ? THEN ? ELSE 'invalid' END, updated_at = ? WHERE id = ?").bind(order.status,status,timestamp,id),
    db.prepare("INSERT INTO order_events (id,order_id,actor_id,from_status,to_status,created_at) VALUES (?,?,?,?,?,?)").bind(uid(),id,actorId,order.status,status,timestamp)];
  if (status === "cancelled") {
    const items = await db.prepare("SELECT * FROM order_items WHERE order_id = ?").bind(id).all<ItemRow>();
    for (const item of items.results) {
      statements.push(db.prepare("UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?").bind(item.quantity,timestamp,item.product_id));
      statements.push(db.prepare("INSERT INTO stock_movements (id,product_id,order_id,actor_id,delta,reason,created_at) VALUES (?,?,?,?,?,?,?)").bind(uid(),item.product_id,id,actorId,item.quantity,"Order cancellation",timestamp));
    }
  }
  try { await db.batch(statements); }
  catch (error) { if (constraintError(error)) throw new ApiError(409,"The order or inventory changed. Refresh and try again."); throw error; }
  return (await hydrateOrders(db,[await getOrder(db,id)]))[0];
}
export async function dashboard(db: D1Database, user: User) {
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0,0,0,0); monthStart.setUTCMonth(monthStart.getUTCMonth()-5);
  const [orderStats,productStats,monthly,lowStock,recentOrders] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(CASE WHEN status = 'delivered' THEN total_cents ELSE 0 END),0) AS revenue, COUNT(*) AS count FROM orders").first<{revenue:number;count:number}>(),
    db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN stock <= reorder_level THEN 1 ELSE 0 END),0) AS low FROM products WHERE active = 1").first<{count:number;low:number}>(),
    db.prepare("SELECT substr(created_at,1,7) AS month, SUM(total_cents) AS value FROM orders WHERE status = 'delivered' AND created_at >= ? GROUP BY substr(created_at,1,7)").bind(monthStart.toISOString()).all<{month:string;value:number}>(),
    db.prepare("SELECT * FROM products WHERE active = 1 AND stock <= reorder_level ORDER BY stock, name LIMIT 50").all<ProductRow>(),
    listOrders(db,user,8),
  ]);
  const revenueSeries = Array.from({length:6},(_,i) => {
    const date = new Date(monthStart); date.setUTCMonth(date.getUTCMonth()+i);
    const month = date.toISOString().slice(0,7);
    return {label:date.toLocaleDateString("en-US",{month:"short",timeZone:"UTC"}),value:monthly.results.find(r => r.month === month)?.value ?? 0};
  });
  return {revenueCents:orderStats?.revenue ?? 0,orderCount:orderStats?.count ?? 0,productCount:productStats?.count ?? 0,lowStockCount:productStats?.low ?? 0,revenueSeries,recentOrders,lowStockProducts:lowStock.results.map(productView)};
}
