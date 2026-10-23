import { authorize, body, database, endpoint, json, mutation, query, resourceId } from "@/lib/server/http";
import { stockSchema } from "@/lib/server/validation";
import { adjustStock } from "@/lib/server/store";
export const dynamic = "force-dynamic";
export const POST = endpoint(async request => {
  const user = await authorize(request,true); query(request); mutation(request); const id = resourceId(request,1);
  const input = await body(request,stockSchema);
  return json({product:await adjustStock(database(),id,input.delta,input.reason,user.id)});
});
