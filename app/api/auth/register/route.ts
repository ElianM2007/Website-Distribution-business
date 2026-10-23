import { env } from "cloudflare:workers";
import { body, database, endpoint, json, mutation, query } from "@/lib/server/http";
import { register } from "@/lib/server/auth";
import { registerSchema } from "@/lib/server/validation";
export const dynamic = "force-dynamic";
export const POST = endpoint(async request => {
  query(request); mutation(request);
  const result = await register(database(),request,await body(request,registerSchema),env);
  const response = json({user:result.user},201); response.headers.set("Set-Cookie",result.cookie); return response;
});
