import type { RfqFilters, SetAsideKey } from "@/lib/rfq/types";

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

const nf = new Intl.NumberFormat("en-US");
export const fmtInt = (n: number) => nf.format(n);

/** "12 min ago", "3 h ago", "2 d ago". */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-16" -> "Oct 16" (no timezone math: pure string). */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  const mi = Number(m) - 1;
  if (!(mi >= 0 && mi < 12) || !d) return iso;
  return `${MONTHS[mi]} ${Number(d)}`;
}

const dayNum = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
};
export const todayIsoUtc = () => new Date().toISOString().slice(0, 10);
/** Whole days from `today` to `dateIso` (negative = past). */
export const daysUntil = (dateIso: string, today: string) => dayNum(dateIso) - dayNum(today);

/** "59 · Electrical & Electronic ..." (or " - ") -> { code: "59", name: "Electrical ..." } */
export function splitFsgLabel(label: string): { code: string; name: string } {
  const m = /^(\d{2})\s*[-·–]\s*(.+)$/.exec(label);
  return m ? { code: m[1], name: m[2] } : { code: label, name: "" };
}

/** Number of user-visible active filters (drives the badge on the mobile Filters button and "Clear all"). */
export function activeFilterCount(f: RfqFilters): number {
  return (
    (f.q ? 1 : 0) +
    f.fsg.length +
    f.fsc.length +
    f.setAside.length +
    (f.fastAward ? 1 : 0) +
    (f.hasDocs ? 1 : 0) +
    (f.closesWithin != null ? 1 : 0) +
    (f.issuedFrom || f.issuedTo ? 1 : 0) +
    (f.qtyMin != null || f.qtyMax != null ? 1 : 0) +
    (f.includeClosed ? 1 : 0)
  );
}
