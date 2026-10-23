import { authorize, body, database, endpoint, json, mutation, query, resourceId } from "@/lib/server/http";
import { orderStatusSchema } from "@/lib/server/validation";
import { updateOrderStatus } from "@/lib/server/store";
export const dynamic = "force-dynamic";
export const PATCH = endpoint(async request => {
  const user = await authorize(request,true); query(request); mutation(request); const id = resourceId(request);
  const input = await body(request,orderStatusSchema);
  return json({order:await updateOrderStatus(database(),id,input.status,user.id)});
});
