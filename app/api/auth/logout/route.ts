import { body, database, endpoint, json, mutation, query } from "@/lib/server/http";
import { logout } from "@/lib/server/auth";
import { emptyQuerySchema } from "@/lib/server/validation";
export const dynamic = "force-dynamic";
export const POST = endpoint(async request => {
  query(request); mutation(request); await body(request,emptyQuerySchema);
  const cookie = await logout(database(),request);
  const response = json({user:null}); response.headers.set("Set-Cookie",cookie); return response;
});
