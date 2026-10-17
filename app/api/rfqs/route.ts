import { connection } from "next/server";
import { parseFilters } from "@/lib/rfq/params";
import { applyFilters, makeCtx, scoreRows, sortRows, toView } from "@/lib/rfq/query";
import { getSnapshot, todayIso } from "@/lib/rfq/store";
import type { ListResponse } from "@/lib/rfq/types";
import { json } from "../_json";

export async function GET(request: Request) {
  await connection(); // request-time only (Cache Components: no route-segment `dynamic` export)
  const f = parseFilters(new URL(request.url).searchParams);
  const { rows } = await getSnapshot();
  const ctx = makeCtx(todayIso());

  const filtered = applyFilters(rows, f, ctx);
  const { items, interests } = scoreRows(filtered, f);
  const sorted = sortRows(items, f.sort);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / f.pageSize));
  const page = Math.min(f.page, pages);
  const slice = sorted.slice((page - 1) * f.pageSize, page * f.pageSize);

  const body: ListResponse = {
    items: slice.map((it) => toView(it, ctx, interests)),
    total,
    page,
    pageSize: f.pageSize,
    pages,
  };
  return json(body);
}
