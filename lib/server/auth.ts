import { scrypt, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { ApiError } from "./errors";

export type Account = {id:string;name:string;email:string;role:"staff"|"client";status:"pending"|"approved"|"rejected";createdAt:string;updatedAt:string};
type AccountRow = {id:string;name:string;email:string;role:Account["role"];status:Account["status"];password_hash:string;created_at:string;updated_at:string};
type Signup = {name:string;email:string;password:string};
type AuthConfig = {OWNER_EMAIL?:string;OWNER_SETUP_TOKEN?:string};
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const view = (row:AccountRow):Account => ({id:row.id,name:row.name,email:row.email,role:row.role,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at});
const userView = (row:Account) => ({id:row.id,name:row.name,email:row.email,role:row.role,status:row.status});
const randomHex = (length:number) => Buffer.from(crypto.getRandomValues(new Uint8Array(length))).toString("hex");
export async function sha256(value:string) { return Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))).toString("hex"); }
function derive(password:string,salt:Buffer):Promise<Buffer> {
  // OWASP's 16 MiB scrypt profile; fits Workers' 128 MiB isolate limit.
  return new Promise((resolve,reject) => scrypt(password,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024},(error,key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password:string) {
  const salt = Buffer.from(randomHex(16),"hex");
  const key = await derive(password,salt);
  return `scrypt$16384$8$5$${salt.toString("hex")}$${key.toString("hex")}`;
}
export async function verifyPassword(password:string,encoded:string) {
  const match = /^scrypt\$16384\$8\$5\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded);
  if (!match) return false;
  const key = await derive(password,Buffer.from(match[1],"hex"));
  return timingSafeEqual(key,Buffer.from(match[2],"hex"));
}
function cookieName(request:Request) {
  const url = new URL(request.url);
  if (url.protocol === "https:") return "__Host-relay_session";
  if (["localhost","127.0.0.1","[::1]"].includes(url.hostname)) return "relay_session";
  throw new ApiError(503,"Secure HTTPS is required for account sessions.");
}
function readToken(request:Request) {
  const name = cookieName(request);
  const matching = (request.headers.get("cookie") ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (matching.length !== 1) return null;
  const token = matching[0].slice(name.length+1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export function sessionCookie(request:Request,token:string,maxAge = SESSION_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
export async function getSessionUser(db:D1Database,request:Request) {
  const token = readToken(request); if (!token) return null;
  const row = await db.prepare("SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?").bind(await sha256(token),Date.now()).first<AccountRow>();
  return row ? userView(view(row)) : null;
}
async function establishSession(db:D1Database,request:Request,account:Account) {
  const token = randomHex(32), hash = await sha256(token), old = readToken(request), timestamp = Date.now();
  const statements = [db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(timestamp)];
  if (old) statements.push(db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(old)));
  statements.push(db.prepare("INSERT INTO sessions (token_hash,account_id,expires_at,created_at) VALUES (?,?,?,?)").bind(hash,account.id,timestamp+SESSION_SECONDS*1000,new Date(timestamp).toISOString()));
  await db.batch(statements);
  return {user:userView(account),cookie:sessionCookie(request,token)};
}
export async function logout(db:D1Database,request:Request) {
  const token = readToken(request);
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
  return sessionCookie(request,"",0);
}
export async function rateLimit(db:D1Database,key:string,limit:number,windowSeconds:number) {
  const timestamp = Date.now();
  const result = await db.prepare("INSERT INTO auth_rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING count")
    .bind(await sha256(key),timestamp+windowSeconds*1000,timestamp,timestamp,timestamp+windowSeconds*1000).first<{count:number}>();
  if (!result || result.count > limit) throw new ApiError(429,"Too many attempts. Please wait before trying again.");
}
async function limitAuth(db:D1Database,request:Request,action:string,email:string) {
  // Cloudflare sets this header at its trusted edge. No client-supplied forwarded header is used.
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  await rateLimit(db,`${action}:ip:${ip}`,action === "login" ? 50 : 5,action === "login" ? 900 : 3600);
  await rateLimit(db,`${action}:email:${email}`,action === "login" ? 10 : 5,action === "login" ? 900 : 3600);
  await db.prepare("DELETE FROM auth_rate_limits WHERE expires_at<=?").bind(Date.now()).run();
}
export async function register(db:D1Database,request:Request,input:Signup,config:AuthConfig) {
  await limitAuth(db,request,"register",input.email);
  if (config.OWNER_EMAIL?.trim().toLowerCase() === input.email) throw new ApiError(409,"This email is reserved for owner setup. Use the owner setup form.");
  const passwordHash = await hashPassword(input.password), timestamp = new Date().toISOString(), id = crypto.randomUUID();
  try { await db.prepare("INSERT INTO accounts (id,name,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,'client','pending',?,?)").bind(id,input.name,input.email,passwordHash,timestamp,timestamp).run(); }
  catch (error) { if (/unique/i.test(String(error))) throw new ApiError(409,"Unable to register this email. Try signing in or contact the owner."); throw error; }
  return establishSession(db,request,{id,name:input.name,email:input.email,role:"client",status:"pending",createdAt:timestamp,updatedAt:timestamp});
}
export async function login(db:D1Database,request:Request,input:{email:string;password:string}) {
  await limitAuth(db,request,"login",input.email);
  const row = await db.prepare("SELECT * FROM accounts WHERE email=?").bind(input.email).first<AccountRow>();
  const valid = row ? await verifyPassword(input.password,row.password_hash) : (await hashPassword(input.password),false);
  if (!row || !valid) throw new ApiError(401,"Email or password is incorrect.");
  if (row.status === "rejected") throw new ApiError(403,"This account is not approved. Please contact the owner.");
  return establishSession(db,request,view(row));
}
export async function bootstrap(db:D1Database,request:Request,input:Signup & {setupToken:string},config:AuthConfig) {
  await limitAuth(db,request,"bootstrap",input.email);
  if (!config.OWNER_EMAIL || !config.OWNER_SETUP_TOKEN || config.OWNER_SETUP_TOKEN.length < 32) throw new ApiError(503,"Owner setup is not configured. Set OWNER_EMAIL and a secure OWNER_SETUP_TOKEN at runtime.");
  const expected = Buffer.from(await sha256(config.OWNER_SETUP_TOKEN),"hex"), received = Buffer.from(await sha256(input.setupToken),"hex");
  if (!timingSafeEqual(expected,received) || input.email !== config.OWNER_EMAIL.trim().toLowerCase()) throw new ApiError(403,"Owner setup credentials are invalid.");
  if (await db.prepare("SELECT slot FROM owner_bootstrap WHERE slot=1").first()) throw new ApiError(409,"Owner setup has already been completed.");
  const hash = await hashPassword(input.password), id = crypto.randomUUID(), timestamp = new Date().toISOString();
  try {
    await db.batch([
      db.prepare("INSERT INTO accounts (id,name,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,'staff','approved',?,?)").bind(id,input.name,input.email,hash,timestamp,timestamp),
      db.prepare("INSERT INTO owner_bootstrap (slot,account_id) VALUES (1,?)").bind(id),
    ]);
  } catch (error) { if (/unique|constraint/i.test(String(error))) throw new ApiError(409,"Owner setup has already been completed or this email is already registered."); throw error; }
  return establishSession(db,request,{id,name:input.name,email:input.email,role:"staff",status:"approved",createdAt:timestamp,updatedAt:timestamp});
}
export async function listAccounts(db:D1Database,limit=500,offset=0) {
  const rows = await db.prepare("SELECT id,name,email,role,status,created_at,updated_at FROM accounts ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,created_at DESC LIMIT ? OFFSET ?").bind(limit,offset).all<AccountRow>();
  return rows.results.map(view);
}
export async function setAccountStatus(db:D1Database,id:string,status:Account["status"],actorId:string) {
  const current = await db.prepare("SELECT id,name,email,role,status,created_at,updated_at FROM accounts WHERE id=?").bind(id).first<AccountRow>();
  if (!current) throw new ApiError(404,"Account not found.");
  if (current.role === "staff") throw new ApiError(403,"The owner account cannot be changed here.");
  const timestamp = new Date().toISOString();
  const statements = [db.prepare("UPDATE accounts SET status=?,updated_at=? WHERE id=? AND role='client'").bind(status,timestamp,id),
    db.prepare("INSERT INTO account_events (id,account_id,actor_id,status,created_at) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(),id,actorId,status,timestamp)];
  if (status !== "approved") statements.push(db.prepare("DELETE FROM sessions WHERE account_id=?").bind(id));
  await db.batch(statements);
  return view({...current,status,updated_at:timestamp});
}
