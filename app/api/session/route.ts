import { endpoint, json, query, sessionUser } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export const GET = endpoint(async request => { query(request); return json({user:await sessionUser(request)}); });
