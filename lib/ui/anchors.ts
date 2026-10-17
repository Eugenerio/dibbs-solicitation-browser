// Semantic "taste" anchors: RFQs the vendor opened (w=1) or saved (w=3). Weights decay with a 14-day half-life at read.
// Sent to the API as `sem=SOL:weight,...`; the server ignores it when no embeddings exist.
const KEY = "sb.anchors.v1";
const HALF_LIFE_MS = 14 * 86_400_000;

type Store = Record<string, { w: number; t: number }>; // weight as of time t

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Store) : {};
  } catch {
    return {};
  }
}

function write(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: anchors are best-effort */
  }
}

const decayed = (a: { w: number; t: number }, now: number) => a.w * 0.5 ** ((now - a.t) / HALF_LIFE_MS);

export function addAnchor(sol: string, w: number) {
  const now = Date.now();
  const s = read();
  const prev = s[sol];
  s[sol] = { w: (prev ? decayed(prev, now) : 0) + w, t: now };
  const keep = Object.entries(s).sort((a, b) => decayed(b[1], now) - decayed(a[1], now)).slice(0, 100);
  write(Object.fromEntries(keep));
}

export function removeAnchor(sol: string) {
  const s = read();
  if (!(sol in s)) return;
  delete s[sol];
  write(s);
}

/** Top anchors by decayed weight as "SOL:weight,..." (weight clamped to 0.5-5), or "" when there are none. */
export function getAnchorParam(limit = 12): string {
  const now = Date.now();
  return Object.entries(read())
    .map(([sol, a]) => [sol, decayed(a, now)] as const)
    .filter(([, w]) => w >= 0.25)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([sol, w]) => `${sol}:${Math.min(5, Math.max(0.5, w)).toFixed(1)}`)
    .join(",");
}
