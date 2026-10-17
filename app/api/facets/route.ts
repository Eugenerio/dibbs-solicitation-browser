import { connection } from "next/server";
import { parseFilters } from "@/lib/rfq/params";
import { buildFacets, makeCtx } from "@/lib/rfq/query";
import { getSemantic } from "@/lib/rfq/semantic";
import { getSnapshot, todayIso } from "@/lib/rfq/store";
import { json } from "../_json";

export async function GET(request: Request) {
  await connection();
  const sp = new URL(request.url).searchParams;
  const f = parseFilters(sp);
  const { rows } = await getSnapshot();
  return json(buildFacets(rows, f, makeCtx(todayIso()), await getSemantic(sp.get("sem"), rows)));
}
