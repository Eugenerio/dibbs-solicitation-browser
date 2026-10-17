import { connection } from "next/server";
import type { RefreshStatus } from "@/lib/rfq/types";
import { json } from "../_json";

// Module-level status, pinned on globalThis so dev HMR reloads don't lose a running refresh.
const g = globalThis as unknown as { __refreshStatus?: RefreshStatus };
const status = (): RefreshStatus =>
  (g.__refreshStatus ??= {
    running: false, startedAt: null, finishedAt: null,
    progress: { done: 0, total: 0 }, error: null, added: null, totalRfqs: null,
  });

async function run(days?: number) {
  const s = status();
  try {
    const { ingest } = await import("@/lib/dibbs/ingest"); // dynamic: a missing/broken scraper can't break other routes
    const res = await ingest({
      days,
      onProgress: (done, total, message) => { s.progress = { done, total, message }; },
    });
    s.added = res.added;
    s.totalRfqs = res.total;
  } catch (e) {
    s.error = e instanceof Error ? e.message : String(e);
  } finally {
    s.running = false;
    s.finishedAt = new Date().toISOString();
  }
}

export async function GET() {
  await connection();
  return json(status());
}

export async function POST(request: Request) {
  await connection();
  const s = status();
  if (!s.running) {
    let days: number | undefined;
    try {
      const body = (await request.json()) as { days?: unknown };
      const n = Number(body?.days);
      if (Number.isFinite(n) && n >= 1) days = Math.min(30, Math.floor(n));
    } catch { /* empty / invalid body: use ingest defaults */ }
    Object.assign(s, {
      running: true, startedAt: new Date().toISOString(), finishedAt: null,
      progress: { done: 0, total: 0 }, error: null, added: null, totalRfqs: null,
    } satisfies RefreshStatus);
    void run(days); // fire and forget
  }
  return json(s, 202);
}
