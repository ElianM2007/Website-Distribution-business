import { body, database, endpoint, json, mutation, query } from "@/lib/server/http";
import { login } from "@/lib/server/auth";
import { loginSchema } from "@/lib/server/validation";
export const dynamic = "force-dynamic";
export const POST = endpoint(async request => {
  query(request); mutation(request);
  const result = await login(database(),request,await body(request,loginSchema));
  const response = json({user:result.user}); response.headers.set("Set-Cookie",result.cookie); return response;
});
