import { authorize, database, endpoint, json, query } from "@/lib/server/http";
import { dashboard } from "@/lib/server/store";
export const dynamic = "force-dynamic";
export const GET = endpoint(async request => { const user = await authorize(request,true); query(request); return json(await dashboard(database(),user)); });
