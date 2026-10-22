import { authorize, body, database, endpoint, json, mutation, query } from "@/lib/server/http";
import { createProductSchema, listQuerySchema } from "@/lib/server/validation";
import { createProduct, listProducts } from "@/lib/server/store";
export const dynamic = "force-dynamic";
export const GET = endpoint(async request => {
  const user = await authorize(); const params = query(request,listQuerySchema);
  return json({products:await listProducts(database(),user.role === "staff",params.limit,params.offset)});
});
export const POST = endpoint(async request => {
  const user = await authorize(true); query(request); mutation(request);
  const input = await body(request,createProductSchema);
  return json({product:await createProduct(database(),input,user.id)},201);
});
