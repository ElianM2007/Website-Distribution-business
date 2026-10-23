import { authorize, database, endpoint, json, query } from "@/lib/server/http";
import { listAccounts } from "@/lib/server/auth";
import { listQuerySchema } from "@/lib/server/validation";
export const dynamic = "force-dynamic";
export const GET = endpoint(async request => {
  await authorize(request,true); const params = query(request,listQuerySchema);
  return json({accounts:await listAccounts(database(),params.limit,params.offset)});
});
