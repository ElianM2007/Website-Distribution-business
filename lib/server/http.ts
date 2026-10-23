import { z } from "zod";
import { env } from "cloudflare:workers";
import { getSessionUser } from "./auth";
import { emptyQuerySchema, uuid } from "./validation";
import { ApiError } from "./errors";
export { ApiError } from "./errors";

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" } });
}
export function endpoint(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try { return await handler(request); }
    catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      if (error instanceof z.ZodError) return json({ error: error.issues.map(i => `${i.path.join(".") || "Request"}: ${i.message}`).join("; ") }, 400);
      console.error("API operation failed", error instanceof Error ? error.name : "Unknown error");
      return json({ error: "The operation could not be completed. Please try again." }, 500);
    }
  };
}
export async function sessionUser(request:Request) {
  return getSessionUser(database(),request);
}
export async function authorize(request:Request,staff = false) {
  const user = await sessionUser(request);
  if (!user) throw new ApiError(401, "Sign in to continue.");
  if (user.status !== "approved") throw new ApiError(403,"Your account must be approved by the owner before you can access this application.");
  if (staff && user.role !== "staff") throw new ApiError(403, "Staff access is required.");
  return user;
}
export function query<T extends z.ZodTypeAny>(request: Request, schema: T = emptyQuerySchema as unknown as T): z.infer<T> {
  const url = new URL(request.url);
  if (url.search.length > 2048) throw new ApiError(400,"Query string is too long.");
  const params = url.searchParams;
  const values: Record<string,string> = Object.create(null);
  for (const [key,value] of params) {
    if (Object.hasOwn(values,key)) throw new ApiError(400,"Duplicate query parameters are not allowed.");
    values[key] = value;
  }
  return schema.parse(values);
}
export function mutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site")
    throw new ApiError(403,"This request must originate from this application.");
  if (request.headers.get("x-requested-with") !== "Relay") throw new ApiError(403,"Missing request verification header.");
}
export async function body<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ApiError(415,"Use application/json.");
  const maxBytes = 32768;
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new ApiError(413,"Request body is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400,"A JSON request body is required.");
  const chunks: Uint8Array[] = []; let count = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    count += next.value.byteLength;
    if (count > maxBytes) { await reader.cancel(); throw new ApiError(413,"Request body is too large."); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)); }
  catch { throw new ApiError(400,"Provide a valid UTF-8 JSON body."); }
  return schema.parse(parsed);
}
export function resourceId(request: Request, segment = 0): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return uuid.parse(parts[parts.length - 1 - segment]);
}
export function database() {
  if (!env.DB) throw new ApiError(503,"Inventory storage is not configured.");
  return env.DB;
}
