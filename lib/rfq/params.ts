// Single codec for filters <-> URL query string. Used by the API route handlers AND the UI (so URLs are shareable).
import type { RfqFilters, SetAsideKey, SortKey } from "./types";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
const SORTS: SortKey[] = ["closing", "newest", "qty", "item", "match"];
const ASIDES: SetAsideKey[] = ["unrestricted", "small_business", "hubzone", "sdvosb", "wosb", "edwosb", "combined", "other"];

export const defaultFilters = (): RfqFilters => ({
  q: "", fsg: [], fsc: [], setAside: [], fastAward: false, hasDocs: false, closesWithin: null,
  issuedFrom: null, issuedTo: null, qtyMin: null, qtyMax: null, includeClosed: false,
  sort: "closing", page: 1, pageSize: DEFAULT_PAGE_SIZE, intFsc: [], intKw: [], matchesOnly: false,
});

const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const int = (v: string | null) => { if (v == null || v === "") return null; const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const isoDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Param names: q fsg fsc aside fast docs closes from to qmin qmax closed sort page size ifsc ikw matches */
export function parseFilters(sp: URLSearchParams): RfqFilters {
  const d = defaultFilters();
  const sort = sp.get("sort") as SortKey | null;
  return {
    q: (sp.get("q") ?? "").trim(),
    fsg: list(sp.get("fsg")).filter((x) => /^\d{2}$/.test(x)),
    fsc: list(sp.get("fsc")).filter((x) => /^\d{4}$/.test(x)),
    setAside: list(sp.get("aside")).filter((x): x is SetAsideKey => (ASIDES as string[]).includes(x)),
    fastAward: sp.get("fast") === "1",
    hasDocs: sp.get("docs") === "1",
    closesWithin: int(sp.get("closes")),
    issuedFrom: isoDate(sp.get("from")),
    issuedTo: isoDate(sp.get("to")),
    qtyMin: int(sp.get("qmin")),
    qtyMax: int(sp.get("qmax")),
    includeClosed: sp.get("closed") === "1",
    sort: sort && SORTS.includes(sort) ? sort : d.sort,
    page: Math.max(1, int(sp.get("page")) ?? 1),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, int(sp.get("size")) ?? DEFAULT_PAGE_SIZE)),
    intFsc: list(sp.get("ifsc")).filter((x) => /^\d{2}(\d{2})?$/.test(x)),
    intKw: list(sp.get("ikw")).map((s) => s.toLowerCase()),
    matchesOnly: sp.get("matches") === "1",
  };
}

/** Only non-default values are emitted, so URLs stay short. */
export function toSearchParams(f: RfqFilters): URLSearchParams {
  const d = defaultFilters();
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.fsg.length) sp.set("fsg", f.fsg.join(","));
  if (f.fsc.length) sp.set("fsc", f.fsc.join(","));
  if (f.setAside.length) sp.set("aside", f.setAside.join(","));
  if (f.fastAward) sp.set("fast", "1");
  if (f.hasDocs) sp.set("docs", "1");
  if (f.closesWithin != null) sp.set("closes", String(f.closesWithin));
  if (f.issuedFrom) sp.set("from", f.issuedFrom);
  if (f.issuedTo) sp.set("to", f.issuedTo);
  if (f.qtyMin != null) sp.set("qmin", String(f.qtyMin));
  if (f.qtyMax != null) sp.set("qmax", String(f.qtyMax));
  if (f.includeClosed) sp.set("closed", "1");
  if (f.sort !== d.sort) sp.set("sort", f.sort);
  if (f.page > 1) sp.set("page", String(f.page));
  if (f.pageSize !== d.pageSize) sp.set("size", String(f.pageSize));
  if (f.intFsc.length) sp.set("ifsc", f.intFsc.join(","));
  if (f.intKw.length) sp.set("ikw", f.intKw.join(","));
  if (f.matchesOnly) sp.set("matches", "1");
  return sp;
}
