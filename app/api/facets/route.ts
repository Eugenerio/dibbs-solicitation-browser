import { connection } from "next/server";
import { parseFilters } from "@/lib/rfq/params";
import { buildFacets, makeCtx } from "@/lib/rfq/query";
import { getSnapshot, todayIso } from "@/lib/rfq/store";
import { json } from "../_json";

export async function GET(request: Request) {
  await connection();
  const f = parseFilters(new URL(request.url).searchParams);
  const { rows } = await getSnapshot();
  return json(buildFacets(rows, f, makeCtx(todayIso())));
}
