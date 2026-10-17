// Tiny, failure-tolerant localStorage helpers (private mode / blocked storage must never break the app).

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled: ignore */
  }
}

export const KEYS = {
  saved: "solbrowser:saved:v1",
  interests: "solbrowser:interests:v1",
} as const;

/** What the vendor says they can supply. fsg = 2-digit supply groups, fsc = 4-digit classes, kw = keywords. */
export interface Interests {
  fsg: string[];
  fsc: string[];
  kw: string[];
}

export const emptyInterests = (): Interests => ({ fsg: [], fsc: [], kw: [] });
export const interestCount = (i: Interests) => i.fsg.length + i.fsc.length + i.kw.length;

const strs = (v: unknown, re: RegExp, lower = false): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => (lower ? x.trim().toLowerCase() : x.trim())).filter((x) => re.test(x)))]
    : [];

export function readInterests(): Interests {
  const raw = readJson<Partial<Interests>>(KEYS.interests, {});
  return { fsg: strs(raw.fsg, /^\d{2}$/), fsc: strs(raw.fsc, /^\d{4}$/), kw: strs(raw.kw, /^.{2,40}$/, true) };
}

export interface StarterProfile {
  id: string;
  label: string;
  hint: string;
  fsg: string[];
}

export const STARTER_PROFILES: StarterProfile[] = [
  { id: "electronics", label: "Electronics & components", hint: "Groups 58, 59, 61, 62", fsg: ["58", "59", "61", "62"] },
  { id: "apparel", label: "Apparel & textiles", hint: "Groups 83, 84", fsg: ["83", "84"] },
  { id: "hardware", label: "Hardware, fasteners & tools", hint: "Groups 51, 53, 47, 48", fsg: ["51", "53", "47", "48"] },
];
