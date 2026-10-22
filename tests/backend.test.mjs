import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import * as store from "../lib/server/store.ts";
import * as validation from "../lib/server/validation.ts";
import * as http from "../lib/server/http.ts";
import * as productsRoute from "../app/api/products/route.ts";
import * as ordersRoute from "../app/api/orders/route.ts";
import * as statusRoute from "../app/api/orders/[id]/route.ts";
import * as dashboardRoute from "../app/api/dashboard/route.ts";
import * as sessionRoute from "../app/api/session/route.ts";

class SQLiteD1 {
  sql = new DatabaseSync(":memory:");
  beforeBatch = null;
  constructor() {
    this.sql.exec("PRAGMA foreign_keys=ON");
    const dir = new URL("../drizzle/",import.meta.url);
    const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
    assert.ok(files.length,"Generate migrations before running database tests");
    for (const file of files) this.sql.exec(readFileSync(new URL(file,dir),"utf8"));
  }
  prepare(sql) {
    const db = this;
    const create = (params = []) => ({
      bind(...values) { return create(values); },
      async first() { return db.sql.prepare(sql).get(...params) ?? null; },
      async all() { return {results:db.sql.prepare(sql).all(...params),success:true}; },
      async run() { return this.execute(); },
      execute() { const result = db.sql.prepare(sql).run(...params); return {results:[],success:true,meta:{changes:Number(result.changes)}}; },
    });
    return create();
  }
  async batch(statements) {
    if (this.beforeBatch) { const callback = this.beforeBatch; this.beforeBatch = null; callback(this.sql); }
    this.sql.exec("BEGIN IMMEDIATE");
    try { const result = statements.map(s => s.execute()); this.sql.exec("COMMIT"); return result; }
    catch (error) { this.sql.exec("ROLLBACK"); throw error; }
  }
}
const staff = {id:"staff-id",name:"Warehouse team",email:"staff@example.test",role:"staff"};
const client = {id:"client-id",name:"Client One",email:"one@example.test",role:"client"};
const other = {id:"other-id",name:"Client Two",email:"two@example.test",role:"client"};
const productInput = (extra = {}) => ({sku:"TEST-001",name:"Test product",category:"Pantry",unit:"case",priceCents:1250,stock:10,reorderLevel:3,...extra});
const orderInput = (id,quantity = 3) => ({items:[{productId:id,quantity}],deliveryAddress:"12 Example Street"});
const testEnv = (db,user) => {
  globalThis.__relayTestEnv = {DB:db,STAFF_USER_IDS:staff.id};
  globalThis.__relayTestHeaders = new Headers(user ? {"oai-authenticated-user-id":user.id,"oai-authenticated-user-email":user.email} : {});
};
const request = (path,method = "GET",data,headers = {}) => new Request(`https://relay.example${path}`,{method,headers:{"Content-Type":"application/json","Origin":"https://relay.example","X-Requested-With":"Relay",...headers},...(data === undefined ? {} : {body:JSON.stringify(data)})});

test("strict schemas reject privilege, price, stock and duplicate-item tampering",() => {
  assert.equal(validation.createProductSchema.safeParse({...productInput(),owner:"attacker"}).success,false);
  assert.equal(validation.patchProductSchema.safeParse({stock:100}).success,false);
  assert.equal(validation.createProductSchema.safeParse(productInput({priceCents:1.5})).success,false);
  assert.equal(validation.stockSchema.safeParse({delta:0,reason:"Nothing"}).success,false);
  const id = crypto.randomUUID(), input = orderInput(id);
  assert.equal(validation.createOrderSchema.safeParse({...input,totalCents:1}).success,false);
  assert.equal(validation.createOrderSchema.safeParse({...input,items:[...input.items,...input.items]}).success,false);
  assert.equal(validation.createOrderSchema.safeParse(orderInput(id,0)).success,false);
  assert.equal(validation.createOrderSchema.safeParse({...input,deliveryAddress:"x\u0000address"}).success,false);
});
test("orders reserve inventory atomically, use server prices, and isolate clients",async () => {
  const db = new SQLiteD1(), p = await store.createProduct(db,productInput(),staff.id);
  const order = await store.createOrder(db,client,orderInput(p.id,3),crypto.randomUUID());
  assert.equal(order.totalCents,3750);
  assert.equal((await store.getProduct(db,p.id)).stock,7);
  assert.equal((await store.listOrders(db,client)).length,1);
  assert.equal((await store.listOrders(db,other)).length,0);
  assert.equal((await store.listOrders(db,staff)).length,1);
});
test("idempotent replay does not reserve twice and conflicting replay is rejected",async () => {
  const db = new SQLiteD1(), p = await store.createProduct(db,productInput(),staff.id), key = crypto.randomUUID();
  const first = await store.createOrder(db,client,orderInput(p.id),key);
  const second = await store.createOrder(db,client,orderInput(p.id),key);
  assert.equal(first.id,second.id);
  assert.equal((await store.getProduct(db,p.id)).stock,7);
  await assert.rejects(store.createOrder(db,client,orderInput(p.id,4),key),e => e.status === 409);
});
test("two competing orders cannot oversell the same inventory",async () => {
  const db = new SQLiteD1(), p = await store.createProduct(db,productInput(),staff.id);
  const results = await Promise.allSettled([
    store.createOrder(db,client,orderInput(p.id,8),crypto.randomUUID()),
    store.createOrder(db,other,orderInput(p.id,8),crypto.randomUUID()),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length,1);
  assert.equal(results.find(r => r.status === "rejected").reason.status,409);
  assert.equal((await store.getProduct(db,p.id)).stock,2);
  assert.equal((await store.listOrders(db,staff)).length,1);
});
test("simultaneous cancellation requests restore stock only once",async () => {
  const db = new SQLiteD1(), p = await store.createProduct(db,productInput(),staff.id);
  const order = await store.createOrder(db,client,orderInput(p.id),null);
  const results = await Promise.allSettled([
    store.updateOrderStatus(db,order.id,"cancelled",staff.id),
    store.updateOrderStatus(db,order.id,"cancelled",staff.id),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length,1);
  assert.equal((await store.getProduct(db,p.id)).stock,10);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM order_events").get().n,1);
});
test("concurrent insufficient stock rolls back the whole multi-product order",async () => {
  const db = new SQLiteD1(), p1 = await store.createProduct(db,productInput(),staff.id), p2 = await store.createProduct(db,productInput({sku:"TEST-002"}),staff.id);
  db.beforeBatch = sql => sql.prepare("UPDATE products SET stock=1 WHERE id=?").run(p2.id);
  const input = {...orderInput(p1.id),items:[{productId:p1.id,quantity:3},{productId:p2.id,quantity:3}]};
  await assert.rejects(store.createOrder(db,client,input,null),e => e.status === 409);
  assert.equal((await store.getProduct(db,p1.id)).stock,10);
  assert.equal((await store.getProduct(db,p2.id)).stock,1);
  assert.equal((await store.listOrders(db,staff)).length,0);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM stock_movements WHERE order_id IS NOT NULL").get().n,0);
});
test("repricing and archival races reject stale order snapshots",async () => {
  for (const change of ["price_cents=1500","active=0"]) {
    const db = new SQLiteD1(), p = await store.createProduct(db,productInput(),staff.id);
    db.beforeBatch = sql => sql.prepare(`UPDATE products SET ${change} WHERE id=?`).run(p.id);
    await assert.rejects(store.createOrder(db,client,orderInput(p.id),null),e => e.status === 409);
    assert.equal((await store.getProduct(db,p.id)).stock,10);
    assert.equal((await store.listOrders(db,staff)).length,0);
  }
});
test("cancellation restores inventory exactly once and records audit events",async () => {
  const db = new SQLiteD1(), p = await store.createProduct(db,productInput(),staff.id);
  const order = await store.createOrder(db,client,orderInput(p.id),null);
  await store.updateOrderStatus(db,order.id,"cancelled",staff.id);
  await store.updateOrderStatus(db,order.id,"cancelled",staff.id);
  assert.equal((await store.getProduct(db,p.id)).stock,10);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM order_events").get().n,1);
  await assert.rejects(store.updateOrderStatus(db,order.id,"confirmed",staff.id),e => e.status === 409);
});
test("concurrent cancellation loser cannot restock or add an audit event",async () => {
  const db = new SQLiteD1(), p = await store.createProduct(db,productInput(),staff.id);
  const order = await store.createOrder(db,client,orderInput(p.id),null);
  db.beforeBatch = sql => sql.prepare("UPDATE orders SET status='confirmed' WHERE id=?").run(order.id);
  await assert.rejects(store.updateOrderStatus(db,order.id,"cancelled",staff.id),e => e.status === 409);
  assert.equal((await store.getProduct(db,p.id)).stock,7);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM order_events").get().n,0);
});
test("stock adjustments cannot go negative and archive retains order history",async () => {
  const db = new SQLiteD1(), p = await store.createProduct(db,productInput(),staff.id);
  await store.createOrder(db,client,orderInput(p.id),null);
  await assert.rejects(store.adjustStock(db,p.id,-8,"Physical count",staff.id),e => e.status === 409);
  assert.equal((await store.getProduct(db,p.id)).stock,7);
  await store.updateProduct(db,p.id,{active:false});
  assert.equal((await store.listProducts(db,false)).length,0);
  assert.equal((await store.listProducts(db,true)).length,1);
  assert.equal((await store.listOrders(db,client))[0].items[0].sku,p.sku);
});
test("revenue counts delivered orders and transition sequence is enforced",async () => {
  const db = new SQLiteD1(), p = await store.createProduct(db,productInput(),staff.id);
  const order = await store.createOrder(db,client,orderInput(p.id),null);
  await assert.rejects(store.updateOrderStatus(db,order.id,"delivered",staff.id),e => e.status === 409);
  assert.equal((await store.dashboard(db,staff)).revenueCents,0);
  for (const status of ["confirmed","shipped","delivered"]) await store.updateOrderStatus(db,order.id,status,staff.id);
  assert.equal((await store.dashboard(db,staff)).revenueCents,3750);
  await assert.rejects(store.updateOrderStatus(db,order.id,"cancelled",staff.id),e => e.status === 409);
});
test("API enforces authentication, staff authorization and explicit allowlists",async () => {
  const db = new SQLiteD1(); testEnv(db,null);
  assert.equal((await productsRoute.GET(request("/api/products"))).status,401);
  testEnv(db,client);
  assert.equal((await productsRoute.POST(request("/api/products","POST",productInput()))).status,403);
  assert.equal((await dashboardRoute.GET(request("/api/dashboard"))).status,403);
  assert.equal((await statusRoute.PATCH(request(`/api/orders/${crypto.randomUUID()}`,"PATCH",{status:"cancelled"}))).status,403);
  assert.equal((await (await sessionRoute.GET(request("/api/session"))).json()).user.role,"client");
  globalThis.__relayTestEnv.STAFF_EMAILS = " ONE@EXAMPLE.TEST ";
  assert.equal((await (await sessionRoute.GET(request("/api/session"))).json()).user.role,"staff");
});
test("API rejects cross-origin writes, unknown query/body keys, and malformed IDs",async () => {
  const db = new SQLiteD1(); testEnv(db,staff);
  assert.equal((await productsRoute.POST(request("/api/products","POST",productInput(),{Origin:"https://evil.example"}))).status,403);
  assert.equal((await productsRoute.POST(request("/api/products","POST",productInput(),{"X-Requested-With":""}))).status,403);
  assert.equal((await productsRoute.GET(request("/api/products?secret=1"))).status,400);
  assert.equal((await productsRoute.GET(request("/api/products?limit=1&limit=2"))).status,400);
  assert.equal((await productsRoute.GET(request("/api/products?__proto__=anything"))).status,400);
  assert.equal((await productsRoute.POST(request("/api/products","POST",{...productInput(),role:"staff"}))).status,400);
  assert.equal((await statusRoute.PATCH(request("/api/orders/not-a-uuid","PATCH",{status:"cancelled"}))).status,400);
  assert.equal((await ordersRoute.POST(request("/api/orders","POST",orderInput(crypto.randomUUID()),{"Idempotency-Key":"bad"}))).status,400);
});
test("JSON reading bounds streamed bodies and rejects wrong type and invalid UTF-8",async () => {
  await assert.rejects(http.body(request("/","POST",{value:"x".repeat(33000)}),validation.emptyQuerySchema),e => e.status === 413);
  await assert.rejects(http.body(request("/","POST",{}, {"Content-Type":"text/plain"}),validation.emptyQuerySchema),e => e.status === 415);
  await assert.rejects(http.body(new Request("https://relay.example",{method:"POST",headers:{"Content-Type":"application/json"},body:new Uint8Array([0xff])}),validation.emptyQuerySchema),e => e.status === 400);
});
