import { connection } from "next/server";
import { getSnapshot, dayNumber, todayIso } from "@/lib/rfq/store";
import type { MetaResponse } from "@/lib/rfq/types";
import { json } from "../_json";

export async function GET() {
  await connection();
  const { snapshot, rows } = await getSnapshot();
  const today = todayIso();
  const todayDay = dayNumber(today);
  let open = 0;
  for (const r of rows) if (r.retDay >= todayDay) open++;
  const body: MetaResponse = {
    refreshedAt: snapshot.refreshedAt || null,
    total: rows.length,
    open,
    issueDates: [...snapshot.issueDates].sort().reverse(),
    source: snapshot.source,
    today,
  };
  return json(body);
}
