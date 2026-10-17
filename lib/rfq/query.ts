// Pure query functions over indexed rows. Everything is O(n) per request (one mask pass; facets reuse it).
import { FSG_NAMES, fsgName } from "./fsc";
import { dayNumber, type Row } from "./store";
import type {
  FacetOption,
  FacetsResponse,
  RfqFilters,
  RfqView,
  SetAsideKey,
  SortKey,
} from "./types";

export const SET_ASIDE_LABELS: Record<SetAsideKey, string> = {
  unrestricted: "Unrestricted",
  small_business: "Small Business",
  hubzone: "HUBZone",
  sdvosb: "SDVOSB",
  wosb: "WOSB",
  edwosb: "EDWOSB",
  combined: "Combined",
  other: "Other",
};

// ---- filter failure bits ---------------------------------------------------------------------
const F_Q = 1, F_FSG = 2, F_FSC = 4, F_ASIDE = 8, F_FAST = 16, F_DOCS = 32, F_CLOSES = 64,
  F_ISSUED = 128, F_QTY = 256, F_CLOSED = 512, F_MATCH = 1024;

export type FacetName = "fsg" | "fsc" | "setAside" | "fastAward" | "hasDocs" | "closing" | "issued" | "qty";
const SKIP_BITS: Record<FacetName, number> = {
  fsg: F_FSG, fsc: F_FSC, setAside: F_ASIDE, fastAward: F_FAST, hasDocs: F_DOCS,
  closing: F_CLOSES, issued: F_ISSUED, qty: F_QTY,
};

export interface Interests {
  fsc4: Set<string>;
  fsg2: Set<string>;
  kws: { kw: string; re: RegExp }[];
}

export interface Ctx {
  today: string; // ISO date (UTC)
  todayDay: number;
}
export const makeCtx = (today: string): Ctx => ({ today, todayDay: dayNumber(today) });

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** null when the filters carry no interests profile. */
export function buildInterests(f: RfqFilters): Interests | null {
  if (!f.intFsc.length && !f.intKw.length) return null;
  const fsc4 = new Set(f.intFsc.filter((x) => x.length === 4));
  const fsg2 = new Set(f.intFsc.filter((x) => x.length === 2));
  const kws = [...new Set(f.intKw.map((k) => k.trim().toLowerCase()).filter(Boolean))].map((kw) => ({
    kw,
    re: new RegExp(`(^|[^a-z0-9])${escapeRe(kw)}`, "i"), // word-start match: "valve" hits "VALVE, GATE" and "VALVES"
  }));
  return { fsc4, fsg2, kws };
}

export function scoreRow(row: Row, it: Interests): number {
  const { fsc, fsg, fastAward } = row.rfq;
  let s = 0;
  if (fsc && it.fsc4.has(fsc)) s += 3;
  if (fsg && it.fsg2.has(fsg)) s += 2;
  for (const k of it.kws) if (k.re.test(row.nomLower)) s += 2;
  if (s > 0 && fastAward) s += 1;
  return s;
}

export function matchReasons(row: Row, it: Interests): string[] {
  const { fsc, fsg, fastAward } = row.rfq;
  const out: string[] = [];
  if (fsc && it.fsc4.has(fsc)) out.push(`Class ${fsc}`);
  if (fsg && it.fsg2.has(fsg)) out.push(`Category ${fsg}`);
  for (const k of it.kws) if (k.re.test(row.nomLower)) out.push(`Keyword: ${k.kw}`);
  if (out.length && fastAward) out.push("Fast award");
  return out;
}

// ---- compiled filter ---------------------------------------------------------------------------
interface Compiled {
  tokens: { t: string; digits: string | null }[];
  fsg: Set<string> | null;
  fsc: Set<string> | null;
  aside: Set<string> | null;
  interests: Interests | null;
  f: RfqFilters;
}

function compile(f: RfqFilters): Compiled {
  const tokens = f.q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      const isNumeric = /^[\d-]+$/.test(t) && /\d/.test(t);
      const digits = isNumeric ? t.replace(/-/g, "") : null;
      return { t, digits: digits && digits !== t ? digits : null };
    });
  return {
    tokens,
    fsg: f.fsg.length ? new Set(f.fsg) : null,
    fsc: f.fsc.length ? new Set(f.fsc) : null,
    aside: f.setAside.length ? new Set<string>(f.setAside) : null,
    interests: f.matchesOnly ? buildInterests(f) : null,
    f,
  };
}

function failMask(row: Row, c: Compiled, ctx: Ctx): number {
  const { rfq, hay } = row;
  const f = c.f;
  let m = 0;
  for (const tk of c.tokens) {
    if (!hay.includes(tk.t) && !(tk.digits && hay.includes(tk.digits))) { m |= F_Q; break; }
  }
  if (c.fsg && !(rfq.fsg && c.fsg.has(rfq.fsg))) m |= F_FSG;
  if (c.fsc && !(rfq.fsc && c.fsc.has(rfq.fsc))) m |= F_FSC;
  if (c.aside && !c.aside.has(rfq.setAside)) m |= F_ASIDE;
  if (f.fastAward && !rfq.fastAward) m |= F_FAST;
  if (f.hasDocs && !rfq.hasTechDocs) m |= F_DOCS;
  const daysLeft = row.retDay - ctx.todayDay;
  if (f.closesWithin != null && !(daysLeft >= 0 && daysLeft <= f.closesWithin)) m |= F_CLOSES;
  if (!f.includeClosed && daysLeft < 0) m |= F_CLOSED;
  if ((f.issuedFrom && rfq.issuedDate < f.issuedFrom) || (f.issuedTo && rfq.issuedDate > f.issuedTo)) m |= F_ISSUED;
  if (f.qtyMin != null || f.qtyMax != null) {
    const q = rfq.quantity;
    if (q == null || (f.qtyMin != null && q < f.qtyMin) || (f.qtyMax != null && q > f.qtyMax)) m |= F_QTY;
  }
  if (c.interests && scoreRow(row, c.interests) <= 0) m |= F_MATCH;
  return m;
}

/** Rows passing every filter, optionally ignoring one facet's own selection (used for facet counts). */
export function applyFilters(rows: Row[], f: RfqFilters, ctx: Ctx, opts: { skip?: FacetName } = {}): Row[] {
  const c = compile(f);
  const ignore = opts.skip ? SKIP_BITS[opts.skip] : 0;
  const out: Row[] = [];
  for (let i = 0; i < rows.length; i++) {
    if ((failMask(rows[i], c, ctx) & ~ignore) === 0) out.push(rows[i]);
  }
  return out;
}

// ---- scoring + sorting ---------------------------------------------------------------------------
export interface Item {
  row: Row;
  score: number;
}

export function scoreRows(rows: Row[], f: RfqFilters): { items: Item[]; interests: Interests | null } {
  const interests = buildInterests(f);
  const items: Item[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) items[i] = { row: rows[i], score: interests ? scoreRow(rows[i], interests) : 0 };
  return { items, interests };
}

const byClosing = (a: Item, b: Item) =>
  a.row.retDay - b.row.retDay || (a.row.rfq.issuedDate < b.row.rfq.issuedDate ? 1 : a.row.rfq.issuedDate > b.row.rfq.issuedDate ? -1 : 0);

export function sortRows(items: Item[], sort: SortKey): Item[] {
  const out = items.slice();
  switch (sort) {
    case "newest":
      return out.sort((a, b) =>
        a.row.rfq.issuedDate < b.row.rfq.issuedDate ? 1 : a.row.rfq.issuedDate > b.row.rfq.issuedDate ? -1 : a.row.retDay - b.row.retDay);
    case "qty":
      return out.sort((a, b) => {
        const qa = a.row.rfq.quantity, qb = b.row.rfq.quantity;
        if (qa == null || qb == null) return qa == null ? (qb == null ? 0 : 1) : -1; // nulls last
        return qb - qa;
      });
    case "item":
      return out.sort((a, b) => (a.row.nomLower < b.row.nomLower ? -1 : a.row.nomLower > b.row.nomLower ? 1 : 0));
    case "match":
      return out.sort((a, b) => b.score - a.score || byClosing(a, b));
    case "closing":
    default:
      return out.sort(byClosing);
  }
}

export function toView(item: Item, ctx: Ctx, interests: Interests | null): RfqView {
  const { rfq, retDay } = item.row;
  const view: RfqView = { ...rfq, fsgName: fsgName(rfq.fsg), daysLeft: retDay - ctx.todayDay };
  if (interests) {
    view.score = item.score;
    view.matchReasons = item.score > 0 ? matchReasons(item.row, interests) : [];
  }
  return view;
}

// ---- facets (single pass) ----------------------------------------------------------------------------
const CLOSING_BUCKETS: [string, string, number][] = [
  ["0", "Today", 0],
  ["3", "Within 3 days", 3],
  ["7", "Within 7 days", 7],
  ["14", "Within 14 days", 14],
];

const byCountDesc = (a: FacetOption, b: FacetOption) => b.count - a.count || a.key.localeCompare(b.key);

export function buildFacets(rows: Row[], f: RfqFilters, ctx: Ctx): FacetsResponse {
  const c = compile(f);
  const asideCounts = new Map<string, number>();
  const fsgCounts = new Map<string, number>();
  const issuedCounts = new Map<string, number>();
  const closing = CLOSING_BUCKETS.map(() => 0);
  let total = 0, fast = 0, docs = 0, qMin = Infinity, qMax = -Infinity;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const m = failMask(row, c, ctx);
    if (m === 0) total++;
    const rfq = row.rfq;
    // each facet counts rows that pass every filter except its own
    if ((m & ~F_ASIDE) === 0) asideCounts.set(rfq.setAside, (asideCounts.get(rfq.setAside) ?? 0) + 1);
    if ((m & ~F_FSG) === 0 && rfq.fsg) fsgCounts.set(rfq.fsg, (fsgCounts.get(rfq.fsg) ?? 0) + 1);
    if ((m & ~F_ISSUED) === 0) issuedCounts.set(rfq.issuedDate, (issuedCounts.get(rfq.issuedDate) ?? 0) + 1);
    if ((m & ~F_FAST) === 0 && rfq.fastAward) fast++;
    if ((m & ~F_DOCS) === 0 && rfq.hasTechDocs) docs++;
    if ((m & ~F_CLOSES) === 0) {
      const d = row.retDay - ctx.todayDay;
      if (d >= 0) for (let b = 0; b < CLOSING_BUCKETS.length; b++) if (d <= CLOSING_BUCKETS[b][2]) closing[b]++;
    }
    if ((m & ~F_QTY) === 0 && rfq.quantity != null) {
      if (rfq.quantity < qMin) qMin = rfq.quantity;
      if (rfq.quantity > qMax) qMax = rfq.quantity;
    }
  }

  const setAside: FacetOption[] = [];
  for (const key of Object.keys(SET_ASIDE_LABELS) as SetAsideKey[]) {
    const count = asideCounts.get(key) ?? 0;
    if (count > 0 || f.setAside.includes(key)) setAside.push({ key, label: SET_ASIDE_LABELS[key], count });
  }
  setAside.sort(byCountDesc);

  const fsgAll: FacetOption[] = [...fsgCounts].map(([key, count]) => ({
    key, count, label: FSG_NAMES[key] ? `${key} · ${FSG_NAMES[key]}` : key,
  })).sort(byCountDesc);
  const fsg = fsgAll.slice(0, 40);
  for (const key of f.fsg) { // selected groups never vanish, even outside the top 40 / at zero
    if (!fsg.some((o) => o.key === key)) fsg.push({ key, count: fsgCounts.get(key) ?? 0, label: FSG_NAMES[key] ? `${key} · ${FSG_NAMES[key]}` : key });
  }

  const issued: FacetOption[] = [...issuedCounts]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));

  return {
    total,
    setAside,
    fsg,
    closing: CLOSING_BUCKETS.map(([key, label], i) => ({ key, label, count: closing[i] })),
    fastAward: fast,
    hasDocs: docs,
    issued,
    qty: qMin === Infinity ? { min: 0, max: 0 } : { min: qMin, max: qMax },
  };
}
