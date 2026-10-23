import { authorize, body, database, endpoint, json, mutation, query } from "@/lib/server/http";
import { createOrderSchema, listQuerySchema, uuid } from "@/lib/server/validation";
import { createOrder, listOrders } from "@/lib/server/store";
export const dynamic = "force-dynamic";
export const GET = endpoint(async request => {
  const user = await authorize(request); const params = query(request,listQuerySchema);
  return json({orders:await listOrders(database(),user,params.limit,params.offset)});
});
export const POST = endpoint(async request => {
  const user = await authorize(request); query(request); mutation(request);
  const key = request.headers.get("idempotency-key"); if (key !== null) uuid.parse(key);
  return json({order:await createOrder(database(),user,await body(request,createOrderSchema),key)},201);
});
