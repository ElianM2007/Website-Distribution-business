import { authorize, body, database, endpoint, json, mutation, query } from "@/lib/server/http";
import { createCategory, listCategories } from "@/lib/server/store";
import { categorySchema } from "@/lib/server/validation";
export const dynamic = "force-dynamic";
export const GET = endpoint(async request => { await authorize(request); query(request); return json({categories:await listCategories(database())}); });
export const POST = endpoint(async request => {
  await authorize(request,true); query(request); mutation(request);
  return json({category:await createCategory(database(),(await body(request,categorySchema)).name)},201);
});
