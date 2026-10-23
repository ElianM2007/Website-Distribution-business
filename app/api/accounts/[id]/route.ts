import { authorize, body, database, endpoint, json, mutation, query, resourceId } from "@/lib/server/http";
import { setAccountStatus } from "@/lib/server/auth";
import { accountStatusSchema } from "@/lib/server/validation";
export const dynamic = "force-dynamic";
export const PATCH = endpoint(async request => {
  const user = await authorize(request,true); query(request); mutation(request);
  const id = resourceId(request), input = await body(request,accountStatusSchema);
  return json({account:await setAccountStatus(database(),id,input.status,user.id)});
});
