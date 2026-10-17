import { connection } from "next/server";
import { parseFilters } from "@/lib/rfq/params";
import { applyFilters, makeCtx, scoreRows, sortRows, toView } from "@/lib/rfq/query";
import { getSemantic } from "@/lib/rfq/semantic";
import { getSnapshot, todayIso } from "@/lib/rfq/store";
import type { ListResponse } from "@/lib/rfq/types";
import { json } from "../_json";

export async function GET(request: Request) {
  await connection(); // request-time only (Cache Components: no route-segment `dynamic` export)
  const sp = new URL(request.url).searchParams;
  const f = parseFilters(sp);
  const { rows } = await getSnapshot();
  const ctx = makeCtx(todayIso());
  const sem = await getSemantic(sp.get("sem"), rows); // null unless `sem` anchors + data/embeddings.json

  const filtered = applyFilters(rows, f, ctx, { sem });
  const { items, interests } = scoreRows(filtered, f, sem);
  const sorted = sortRows(items, f.sort);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / f.pageSize));
  const page = Math.min(f.page, pages);
  const slice = sorted.slice((page - 1) * f.pageSize, page * f.pageSize);

  const body: ListResponse = {
    items: slice.map((it) => toView(it, ctx, interests, sem)),
    total,
    page,
    pageSize: f.pageSize,
    pages,
  };
  return json(body);
}
