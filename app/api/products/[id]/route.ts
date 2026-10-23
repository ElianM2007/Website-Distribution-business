import { ApiError, authorize, body, database, endpoint, json, mutation, query, resourceId } from "@/lib/server/http";
import { patchProductSchema } from "@/lib/server/validation";
import { updateProduct } from "@/lib/server/store";
export const dynamic = "force-dynamic";
export const PATCH = endpoint(async request => {
  await authorize(request,true); query(request); mutation(request); const id = resourceId(request);
  return json({product:await updateProduct(database(),id,await body(request,patchProductSchema))});
});
export const DELETE = endpoint(async request => {
  await authorize(request,true); query(request); mutation(request); const id = resourceId(request);
  if (request.body !== null) throw new ApiError(400,"This endpoint does not accept a request body.");
  return json({product:await updateProduct(database(),id,{active:false})});
});
