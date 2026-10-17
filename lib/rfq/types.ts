// Shared contract between scraper (lib/dibbs), query engine + API (lib/rfq, app/api) and UI (components, app/page).

export type SetAsideKey =
  | "unrestricted"
  | "small_business"
  | "hubzone"
  | "sdvosb"
  | "wosb"
  | "edwosb"
  | "combined"
  | "other";

/** One solicitation row as scraped from DIBBS. Stored in data/rfqs.json. Dates are ISO yyyy-mm-dd. */
export interface Rfq {
  solNumber: string; // "SPE1C1-27-T-0025" (unique key)
  nsn: string; // digits only for a real 13-digit NSN ("8465014706253"), otherwise the raw part-number text
  nsnDisplay: string; // "8465-01-470-6253"
  fsg: string | null; // Federal Supply Group = first 2 digits of NSN
  fsc: string | null; // Federal Supply Class = first 4 digits of NSN
  nomenclature: string; // "STRAP, INVOLUNTARY, R"
  quantity: number | null;
  prNumber: string;
  issuedDate: string;
  returnByDate: string; // quote deadline
  status: string; // "Open" etc.
  setAside: SetAsideKey;
  setAsideLabel: string;
  fastAward: boolean; // "Fast Award Candidate": micro-purchase may be awarded before the return date
  hasTechDocs: boolean;
  techDocs: string; // raw "Technical Documents" cell, e.g. "None"
  rfqPdfUrl: string | null;
  packageUrl: string; // DIBBS "Package View" page = the "open on DIBBS" target
  nsnUrl: string | null;
  quoteUrl: string | null;
}

/** data/rfqs.json */
export interface Snapshot {
  refreshedAt: string; // ISO timestamp (UTC)
  source: string; // "https://www.dibbs.bsm.dla.mil/rfq/"
  issueDates: string[]; // ISO dates that were ingested
  rfqs: Rfq[];
}

/** Rfq enriched by the query engine for the UI. */
export interface RfqView extends Rfq {
  fsgName: string | null; // "Electrical and Electronic Equipment Components"
  daysLeft: number; // returnByDate - today (UTC date). 0 = closes today, negative = already closed
  score?: number; // only when interests (ifsc/ikw) were supplied
  matchReasons?: string[]; // e.g. ["Category 59", "Keyword: valve"]
}

export type SortKey = "closing" | "newest" | "qty" | "item" | "match";

export interface RfqFilters {
  q: string; // free text; whitespace-separated tokens are ANDed; matches nsn (with/without dashes), solNumber, nomenclature, prNumber
  fsg: string[]; // 2-digit supply groups
  fsc: string[]; // 4-digit supply classes
  setAside: SetAsideKey[];
  fastAward: boolean;
  hasDocs: boolean;
  closesWithin: number | null; // days from today (0 = today only); null = any
  issuedFrom: string | null;
  issuedTo: string | null;
  qtyMin: number | null;
  qtyMax: number | null;
  includeClosed: boolean; // default false: hide RFQs whose returnByDate is in the past
  sort: SortKey;
  page: number; // 1-based
  pageSize: number; // default 50, max 200
  // "Interests" profile (kept client-side in localStorage, sent with each request so the server can score)
  intFsc: string[]; // 2- or 4-digit prefixes the vendor cares about
  intKw: string[]; // keywords the vendor cares about (matched against nomenclature)
  matchesOnly: boolean; // only rows with score > 0
}

export interface ListResponse {
  items: RfqView[];
  total: number; // after filters
  page: number;
  pageSize: number;
  pages: number;
}

export interface FacetOption {
  key: string;
  label: string;
  count: number;
}

/** Counts are computed under the current filters EXCEPT the facet's own selection (so options never vanish). */
export interface FacetsResponse {
  total: number;
  setAside: FacetOption[];
  fsg: FacetOption[]; // top 40 by count; label = "59 · Electrical & Electronic Components"
  closing: FacetOption[]; // keys "0","3","7","14" = closes within N days
  fastAward: number;
  hasDocs: number;
  issued: FacetOption[]; // key = ISO date, newest first
  qty: { min: number; max: number };
}

export interface MetaResponse {
  refreshedAt: string | null;
  total: number;
  open: number;
  issueDates: string[];
  source: string;
  today: string; // ISO date used for daysLeft
}

export interface RefreshStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  progress: { done: number; total: number; message?: string };
  error: string | null;
  added: number | null;
  totalRfqs: number | null;
}
