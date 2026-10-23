import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import * as store from "../lib/server/store.ts";
import * as validation from "../lib/server/validation.ts";
import * as http from "../lib/server/http.ts";
import * as productsRoute from "../app/api/products/route.ts";
import * as ordersRoute from "../app/api/orders/route.ts";
import * as statusRoute from "../app/api/orders/[id]/route.ts";
import * as dashboardRoute from "../app/api/dashboard/route.ts";
import * as sessionRoute from "../app/api/session/route.ts";
import * as auth from "../lib/server/auth.ts";
import * as registerRoute from "../app/api/auth/register/route.ts";
import * as loginRoute from "../app/api/auth/login/route.ts";
import * as logoutRoute from "../app/api/auth/logout/route.ts";
import * as bootstrapRoute from "../app/api/auth/bootstrap/route.ts";
import * as accountsRoute from "../app/api/accounts/route.ts";
import * as accountRoute from "../app/api/accounts/[id]/route.ts";
import * as categoriesRoute from "../app/api/categories/route.ts";

class SQLiteD1 {
  sql = new DatabaseSync(":memory:");
  beforeBatch = null;
  constructor() {
    this.sql.exec("PRAGMA foreign_keys=ON");
    const dir = new URL("../drizzle/",import.meta.url);
    const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
    assert.ok(files.length,"Generate migrations before running database tests");
    for (const file of files) this.sql.exec(readFileSync(new URL(file,dir),"utf8"));
    this.sql.prepare("INSERT INTO categories (id,name,name_key,created_at) VALUES (?,?,?,?)").run(crypto.randomUUID(),"Pantry","pantry",new Date().toISOString());
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
const staff = {id:crypto.randomUUID(),name:"Warehouse team",email:"staff@example.test",role:"staff",status:"approved"};
const client = {id:crypto.randomUUID(),name:"Client One",email:"one@example.test",role:"client",status:"approved"};
const other = {id:crypto.randomUUID(),name:"Client Two",email:"two@example.test",role:"client",status:"approved"};
const productInput = (extra = {}) => ({sku:"TEST-001",name:"Test product",category:"Pantry",unit:"case",priceCents:1250,stock:10,reorderLevel:3,...extra});
const orderInput = (id,quantity = 3) => ({items:[{productId:id,quantity}],deliveryAddress:"12 Example Street"});
const testEnv = (db,user) => {
  globalThis.__relayTestEnv = {DB:db};
  globalThis.__relayTestCookie = "";
  if (user) {
    const timestamp = new Date().toISOString(),token = randomBytes(32).toString("hex");
    db.sql.prepare("INSERT OR IGNORE INTO accounts (id,name,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(user.id,user.name,user.email,"fixture-not-a-password",user.role,user.status ?? "approved",timestamp,timestamp);
    db.sql.prepare("INSERT INTO sessions (token_hash,account_id,expires_at,created_at) VALUES (?,?,?,?)").run(createHash("sha256").update(token).digest("hex"),user.id,Date.now()+60000,timestamp);
    globalThis.__relayTestCookie = `__Host-relay_session=${token}`;
  }
};
const request = (path,method = "GET",data,headers = {}) => new Request(`https://relay.example${path}`,{method,headers:{"Content-Type":"application/json","Origin":"https://relay.example","X-Requested-With":"Relay","Cookie":globalThis.__relayTestCookie ?? "",...headers},...(data === undefined ? {} : {body:JSON.stringify(data)})});

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
test("API enforces database authentication, staff authorization and dynamic approval",async () => {
  const db = new SQLiteD1(); testEnv(db,null);
  assert.equal((await productsRoute.GET(request("/api/products"))).status,401);
  testEnv(db,client);
  assert.equal((await productsRoute.POST(request("/api/products","POST",productInput()))).status,403);
  assert.equal((await dashboardRoute.GET(request("/api/dashboard"))).status,403);
  assert.equal((await statusRoute.PATCH(request(`/api/orders/${crypto.randomUUID()}`,"PATCH",{status:"cancelled"}))).status,403);
  assert.equal((await (await sessionRoute.GET(request("/api/session"))).json()).user.role,"client");
  db.sql.prepare("UPDATE accounts SET status='pending' WHERE id=?").run(client.id);
  assert.equal((await productsRoute.GET(request("/api/products"))).status,403);
  assert.equal((await (await sessionRoute.GET(request("/api/session"))).json()).user.status,"pending");
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

test("password hashes use random salts and verify without storing plaintext",async () => {
  const password = randomBytes(24).toString("base64url"),first = await auth.hashPassword(password),second = await auth.hashPassword(password);
  assert.notEqual(first,second); assert.equal(first.includes(password),false);
  assert.match(first,/^scrypt\$16384\$8\$5\$/);
  assert.equal(await auth.verifyPassword(password,first),true);
  assert.equal(await auth.verifyPassword(password+"wrong",first),false);
  assert.equal(await auth.verifyPassword(password,"malformed-hash"),false);
});
test("registration starts pending, cookies are secure, and owner approval unlocks access",async () => {
  const db = new SQLiteD1(); testEnv(db,null);
  const password = randomBytes(24).toString("base64url");
  const response = await registerRoute.POST(request("/api/auth/register","POST",{name:"New Client",email:"NEW@EXAMPLE.TEST",password}));
  assert.equal(response.status,201);
  const registered = (await response.json()).user;
  assert.equal(registered.status,"pending"); assert.equal(registered.role,"client"); assert.equal(registered.email,"new@example.test");
  const cookie = response.headers.get("set-cookie");
  for (const flag of ["__Host-relay_session=","HttpOnly","Secure","SameSite=Strict","Path=/"]) assert.ok(cookie.includes(flag));
  const rawToken = cookie.split(";")[0].split("=")[1];
  assert.equal(db.sql.prepare("SELECT token_hash FROM sessions").get().token_hash,createHash("sha256").update(rawToken).digest("hex"));
  globalThis.__relayTestCookie = cookie.split(";")[0];
  assert.equal((await productsRoute.GET(request("/api/products"))).status,403);
  assert.equal((await accountsRoute.GET(request("/api/accounts"))).status,403);
  const clientCookie = globalThis.__relayTestCookie;
  testEnv(db,staff);
  const approval = await accountRoute.PATCH(request(`/api/accounts/${registered.id}`,"PATCH",{status:"approved"}));
  assert.equal(approval.status,200);
  globalThis.__relayTestCookie = clientCookie;
  assert.equal((await productsRoute.GET(request("/api/products"))).status,200);
  assert.equal((await categoriesRoute.POST(request("/api/categories","POST",{name:"Unauthorized"}))).status,403);
});
test("login rejects bad credentials, rotates session, and logout revokes token",async () => {
  const db = new SQLiteD1(); testEnv(db,null);
  const password = randomBytes(24).toString("base64url"), input = {name:"New Client",email:"new@example.test",password};
  const registered = await auth.register(db,request("/"),input,{});
  globalThis.__relayTestCookie = registered.cookie.split(";")[0];
  const oldCookie = globalThis.__relayTestCookie;
  assert.equal((await loginRoute.POST(request("/api/auth/login","POST",{email:input.email,password:"a wrong password"}))).status,401);
  const login = await loginRoute.POST(request("/api/auth/login","POST",{email:input.email,password}));
  assert.equal(login.status,200); const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.notEqual(cookie,oldCookie);
  assert.equal(await auth.getSessionUser(db,request("/", "GET",undefined,{Cookie:oldCookie})),null);
  globalThis.__relayTestCookie = cookie;
  const logout = await logoutRoute.POST(request("/api/auth/logout","POST",{}));
  assert.equal(logout.status,200); assert.match(logout.headers.get("set-cookie"),/Max-Age=0/);
  assert.equal((await (await sessionRoute.GET(request("/api/session"))).json()).user,null);
});
test("expired and forged sessions fail; platform identity headers confer no privileges",async () => {
  const db = new SQLiteD1(); testEnv(db,staff);
  db.sql.prepare("UPDATE sessions SET expires_at=?").run(Date.now()-1);
  assert.equal((await productsRoute.GET(request("/api/products"))).status,401);
  globalThis.__relayTestCookie = `__Host-relay_session=${randomBytes(32).toString("hex")}`;
  assert.equal((await productsRoute.GET(request("/api/products","GET",undefined,{"oai-authenticated-user-id":staff.id,"oai-authenticated-user-email":staff.email}))).status,401);
});
test("rejecting approval revokes existing sessions and owner status cannot change",async () => {
  const db = new SQLiteD1(); testEnv(db,client); const clientCookie = globalThis.__relayTestCookie;
  testEnv(db,staff);
  assert.equal((await accountRoute.PATCH(request(`/api/accounts/${client.id}`,"PATCH",{status:"rejected"}))).status,200);
  assert.equal((await accountRoute.PATCH(request(`/api/accounts/${staff.id}`,"PATCH",{status:"pending"}))).status,403);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM sessions WHERE account_id=?").get(client.id).n,0);
  globalThis.__relayTestCookie = clientCookie;
  assert.equal((await productsRoute.GET(request("/api/products"))).status,401);
});
test("owner setup requires runtime token and email and is one-time",async () => {
  const db = new SQLiteD1(); testEnv(db,null);
  const password = randomBytes(24).toString("base64url"),setupToken = randomBytes(32).toString("hex");
  const input = {name:"Owner",email:"owner@example.test",password,setupToken};
  globalThis.__relayTestEnv.OWNER_EMAIL = input.email;
  globalThis.__relayTestEnv.OWNER_SETUP_TOKEN = setupToken;
  assert.equal((await registerRoute.POST(request("/api/auth/register","POST",{name:input.name,email:input.email,password}))).status,409);
  assert.equal((await bootstrapRoute.POST(request("/api/auth/bootstrap","POST",{...input,setupToken:randomBytes(32).toString("hex")}))).status,403);
  const response = await bootstrapRoute.POST(request("/api/auth/bootstrap","POST",input));
  assert.equal(response.status,201); const owner = (await response.json()).user;
  assert.equal(owner.role,"staff"); assert.equal(owner.status,"approved");
  assert.equal((await bootstrapRoute.POST(request("/api/auth/bootstrap","POST",input))).status,409);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM accounts WHERE role='staff'").get().n,1);
});
test("rate limit counters are persistent and atomically bound attempts",async () => {
  const db = new SQLiteD1();
  const results = await Promise.allSettled(Array.from({length:8},() => auth.rateLimit(db,"login:test",3,900)));
  assert.equal(results.filter(r => r.status === "fulfilled").length,3);
  assert.ok(results.filter(r => r.status === "rejected").every(r => r.reason.status === 429));
  db.sql.prepare("UPDATE auth_rate_limits SET expires_at=?").run(Date.now()-1);
  await auth.rateLimit(db,"login:test",3,900);
  assert.equal(db.sql.prepare("SELECT count FROM auth_rate_limits").get().count,1);
});
test("auth schemas reject privilege injection and CSRF attempts",async () => {
  const db = new SQLiteD1(); testEnv(db,null);
  const input = {name:"Client",email:"new@example.test",password:randomBytes(24).toString("base64url")};
  assert.equal((await registerRoute.POST(request("/api/auth/register","POST",{...input,role:"staff"}))).status,400);
  assert.equal((await registerRoute.POST(request("/api/auth/register","POST",input,{Origin:"https://evil.example"}))).status,403);
  assert.equal((await loginRoute.POST(request("/api/auth/login","POST",{email:input.email,password:input.password},{"X-Requested-With":""}))).status,403);
  assert.equal((await logoutRoute.POST(request("/api/auth/logout","POST",{anything:true}))).status,400);
});
test("only staff creates categories, and products must reference an existing category",async () => {
  const db = new SQLiteD1(); testEnv(db,staff);
  assert.equal((await categoriesRoute.POST(request("/api/categories","POST",{name:"Beverages"}))).status,201);
  assert.equal((await categoriesRoute.POST(request("/api/categories","POST",{name:"beverages"}))).status,409);
  await assert.rejects(store.createProduct(db,productInput({category:"Unknown"}),staff.id),e => e.status === 400);
  const p = await store.createProduct(db,productInput(),staff.id);
  await assert.rejects(store.updateProduct(db,p.id,{category:"Unknown"}),e => e.status === 400);
  assert.equal((await store.updateProduct(db,p.id,{category:"beverages"})).category,"Beverages");
  testEnv(db,client);
  assert.equal((await categoriesRoute.GET(request("/api/categories"))).status,200);
  assert.equal((await categoriesRoute.POST(request("/api/categories","POST",{name:"Other"}))).status,403);
});
test("pickup needs no delivery address and only permits the collection workflow",async () => {
  const db = new SQLiteD1(), p = await store.createProduct(db,productInput(),staff.id);
  assert.equal(validation.createOrderSchema.safeParse({items:[{productId:p.id,quantity:1}],fulfillmentMethod:"delivery"}).success,false);
  const input = validation.createOrderSchema.parse({items:[{productId:p.id,quantity:1}],fulfillmentMethod:"pickup"});
  const order = await store.createOrder(db,client,input,null);
  assert.equal(order.fulfillmentMethod,"pickup"); assert.equal(order.deliveryAddress,"");
  await store.updateOrderStatus(db,order.id,"confirmed",staff.id);
  await assert.rejects(store.updateOrderStatus(db,order.id,"shipped",staff.id),e => e.status === 409);
  assert.equal((await store.updateOrderStatus(db,order.id,"delivered",staff.id)).status,"delivered");
});
