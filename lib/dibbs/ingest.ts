// Pull recent RFQ issue-days from DIBBS and merge them into data/rfqs.json (atomic write).
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Rfq, Snapshot } from "../rfq/types";
import { DibbsClient } from "./client";
import { BASE, GRID_ID, parseIssueDates, parseListing } from "./parse";

export const SNAPSHOT_PATH = path.join(process.cwd(), "data", "rfqs.json");
const MAX_PAGES_PER_DAY = 120; // safety valve (50 rows/page)
const CONCURRENCY = 3; // be polite: a few day-chains at a time
const RETAIN_DAYS_AFTER_CLOSE = 14;

type Progress = (done: number, total: number, message?: string) => void;

const mdy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${m}-${d}-${y}`;
};

/** All RFQs issued on one day. Each day uses its own session: GET page 1, then follow ASP.NET postback paging. */
export async function fetchIssueDay(isoDate: string, onPage?: (page: number, rows: number) => void): Promise<Rfq[]> {
  const client = new DibbsClient();
  const url = `${BASE}/RFQ/RfqRecs.aspx?category=issue&TypeSrch=dt&Value=${mdy(isoDate)}`;
  let html = await client.get(url);
  const all = new Map<string, Rfq>();
  for (let page = 1; page <= MAX_PAGES_PER_DAY; page++) {
    const parsed = parseListing(html);
    const before = all.size;
    for (const r of parsed.rows) all.set(r.solNumber, r);
    onPage?.(page, all.size);
    if (parsed.rows.length === 0 || all.size === before) break; // empty or no new rows => done
    if (parsed.maxPagerArg <= page) break; // pager offers nothing beyond this page
    html = await client.post(url, {
      ...parsed.hidden,
      __EVENTTARGET: GRID_ID,
      __EVENTARGUMENT: `Page$${page + 1}`,
    });
  }
  return Array.from(all.values());
}

export async function readSnapshot(): Promise<Snapshot> {
  try {
    return JSON.parse(await fs.readFile(SNAPSHOT_PATH, "utf8")) as Snapshot;
  } catch {
    return { refreshedAt: new Date(0).toISOString(), source: `${BASE}/rfq/`, issueDates: [], rfqs: [] };
  }
}

async function writeSnapshotAtomic(snap: Snapshot) {
  await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
  const tmp = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(snap));
  await fs.rename(tmp, SNAPSHOT_PATH);
}

export async function ingest(opts: { days?: number; onProgress?: Progress } = {}): Promise<{ added: number; total: number }> {
  const days = Math.max(1, Math.min(opts.days ?? 5, 30));
  const progress = opts.onProgress ?? (() => {});

  progress(0, days, "Finding recent issue dates…");
  const indexHtml = await new DibbsClient().get(`${BASE}/Rfq/RfqDates.aspx?category=issue`);
  const dates = parseIssueDates(indexHtml).slice(0, days);
  if (dates.length === 0) throw new Error("DIBBS returned no issue dates (layout changed or blocked)");

  const fetched: Rfq[] = [];
  let done = 0;
  const queue = [...dates];
  const worker = async () => {
    for (let d = queue.shift(); d; d = queue.shift()) {
      const rows = await fetchIssueDay(d, (page, n) => progress(done, dates.length, `${d}: page ${page}, ${n} RFQs`));
      fetched.push(...rows);
      done++;
      progress(done, dates.length, `${d}: ${rows.length} RFQs`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, dates.length) }, worker));

  // Merge by solicitation number; fresh data wins. Drop long-closed rows so the file stays small.
  const prev = await readSnapshot();
  const byId = new Map(prev.rfqs.map((r) => [r.solNumber, r]));
  let added = 0;
  for (const r of fetched) {
    if (!byId.has(r.solNumber)) added++;
    byId.set(r.solNumber, r);
  }
  const cutoff = new Date(Date.now() - RETAIN_DAYS_AFTER_CLOSE * 86_400_000).toISOString().slice(0, 10);
  const rfqs = Array.from(byId.values())
    .filter((r) => r.returnByDate >= cutoff)
    .sort((a, b) => (a.issuedDate < b.issuedDate ? 1 : a.issuedDate > b.issuedDate ? -1 : a.solNumber.localeCompare(b.solNumber)));

  await writeSnapshotAtomic({
    refreshedAt: new Date().toISOString(),
    source: `${BASE}/rfq/`,
    issueDates: Array.from(new Set([...prev.issueDates, ...dates])).sort().reverse(),
    rfqs,
  });
  progress(dates.length, dates.length, `Done: ${fetched.length} fetched, ${added} new`);
  try {
    // incremental: only new item names are embedded; no key / API error never fails the ingest
    await (await import("../rfq/embed")).embedMissing({ onProgress: opts.onProgress });
  } catch (e) {
    console.warn("embedding skipped:", e);
  }
  return { added, total: rfqs.length };
}
