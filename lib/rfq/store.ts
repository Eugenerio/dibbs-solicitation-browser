// Server-only snapshot loader. Caches parsed rows + search haystacks in module memory, keyed by file mtime.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Rfq, Snapshot } from "./types";

/** A row plus precomputed, request-independent derived data (kept out of the public Rfq shape). */
export interface Row {
  rfq: Rfq;
  hay: string; // lowercase "nsnDisplay nsn solNumber nomenclature prNumber"
  nomLower: string;
  retDay: number; // returnByDate as whole days since epoch (UTC)
}

export interface Loaded {
  snapshot: Snapshot;
  rows: Row[];
}

const DAY_MS = 86_400_000;
export const dayNumber = (iso: string): number => {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : 1e9; // unparseable -> "far future"
};
export const todayIso = (): string => new Date().toISOString().slice(0, 10);

const FILE = () => path.join(process.cwd(), "data", "rfqs.json");

const EMPTY: Loaded = {
  snapshot: { refreshedAt: "", source: "https://www.dibbs.bsm.dla.mil/rfq/", issueDates: [], rfqs: [] },
  rows: [],
};

type Cache = { key: string; loaded: Loaded };
const g = globalThis as unknown as { __rfqCache?: Cache };

function index(snapshot: Snapshot): Loaded {
  const rows: Row[] = new Array(snapshot.rfqs.length);
  for (let i = 0; i < snapshot.rfqs.length; i++) {
    const r = snapshot.rfqs[i];
    const nomLower = (r.nomenclature ?? "").toLowerCase();
    rows[i] = {
      rfq: r,
      nomLower,
      hay: `${r.nsnDisplay} ${r.nsn} ${r.solNumber} ${r.nomenclature} ${r.prNumber}`.toLowerCase(),
      retDay: dayNumber(r.returnByDate),
    };
  }
  return { snapshot, rows };
}

export async function getSnapshot(): Promise<Loaded> {
  const file = FILE();
  let key: string;
  try {
    const st = await stat(file);
    key = `${st.mtimeMs}:${st.size}`;
  } catch {
    return g.__rfqCache?.loaded ?? EMPTY; // file missing: serve last good copy, else empty
  }
  if (g.__rfqCache?.key === key) return g.__rfqCache.loaded;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<Snapshot>;
    const snapshot: Snapshot = {
      refreshedAt: parsed.refreshedAt ?? "",
      source: parsed.source ?? EMPTY.snapshot.source,
      issueDates: parsed.issueDates ?? [],
      rfqs: Array.isArray(parsed.rfqs) ? parsed.rfqs : [],
    };
    const loaded = index(snapshot);
    g.__rfqCache = { key, loaded };
    return loaded;
  } catch {
    return g.__rfqCache?.loaded ?? EMPTY; // unreadable / mid-write: keep serving last good copy
  }
}
