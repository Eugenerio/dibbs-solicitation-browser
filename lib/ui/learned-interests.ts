// Implicit "learned interests": the vendor never fills in a profile, we infer it from behavior.
//
// Model: a sparse term-weight vector over two spaces - categories (FSG 2-digit / FSC 4-digit codes) and item
// keywords (tokens of the nomenclature / search text). Each behavioral event adds a weight to a few terms; weights
// decay exponentially (half-life 14 days) and decay is applied at read time, so stored w is "weight as of t".
// Ranking stays server-side: we compile the top-K terms into the existing ifsc/ikw params (see lib/rfq/query.ts).
// The interface (record* in, getTop out) is deliberately vector-shaped so a dense embedding model
// (e.g. text-embedding of opened/saved items + pgvector similarity) can replace it later without touching the UI.

import { useSyncExternalStore } from "react";
import { FSG_NAMES } from "@/lib/rfq/fsc";
import type { RfqView } from "@/lib/rfq/types";

export interface Term {
  w: number;
  t: number; // epoch ms of the last update (w is the weight at that moment)
}

export interface LearnedProfile {
  fsg: Record<string, Term & { name?: string }>;
  fsc: Record<string, Term>;
  kw: Record<string, Term>;
}

export interface LearnedTop {
  ifsc: string[]; // fsc + fsg prefixes, ready for intFsc
  ikw: string[]; // ready for intKw
  strength: number; // sum of decayed weights (how much we know)
  topCategories: { code: string; label: string; weight: number }[];
  topKeywords: { word: string; weight: number }[];
}

type RfqLike = Pick<RfqView, "fsc" | "fsg" | "nomenclature"> & { fsgName?: string | null };

const KEY = "sb.learned.v1";
const HALF_LIFE_MS = 14 * 24 * 3600 * 1000;
const MIN_TERM = 0.25; // below this a term is noise: not compiled into the query
const PRUNE = 0.05; // below this a term is dropped from storage
const MAX_KW = 200;
/** Below this total weight we don't pretend to know the vendor yet: learned terms are not applied. */
export const LEARNED_MIN_STRENGTH = 3;

// Generic words that say nothing about what a vendor supplies.
const STOP = new Set([
  "with", "without", "from", "that", "this", "than", "into", "only", "each", "unit", "item", "items",
  "assembly", "assy", "part", "parts", "type", "size", "kind", "used", "other", "misc", "general", "spare",
  "rfq", "rfqs", "open", "closing", "solicitation",
]);

export const emptyProfile = (): LearnedProfile => ({ fsg: {}, fsc: {}, kw: {} });
const EMPTY: LearnedProfile = emptyProfile(); // stable server snapshot

/** "STRAP, INVOLUNTARY, R" -> ["strap", "involuntary"] */
export function tokenize(text: string): string[] {
  const out = (text.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 4 && !STOP.has(w));
  return [...new Set(out)];
}

export const decayed = (term: Term | undefined, now = Date.now()): number =>
  term ? term.w * Math.pow(0.5, Math.max(0, now - term.t) / HALF_LIFE_MS) : 0;

// ---- store (module-level cache + tiny emitter, consumed via useSyncExternalStore) ----

let cache: LearnedProfile | null = null;
const listeners = new Set<() => void>();

function load(): LearnedProfile {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<LearnedProfile>) : null;
    if (p && typeof p === "object") return { fsg: p.fsg ?? {}, fsc: p.fsc ?? {}, kw: p.kw ?? {} };
  } catch {
    /* blocked / corrupt: start fresh */
  }
  return emptyProfile();
}

export function getProfile(): LearnedProfile {
  if (!cache) cache = load();
  return cache;
}

function commit(next: LearnedProfile) {
  cache = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / disabled: keep in memory only */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  // Another tab learned something: drop the cache so the next snapshot re-reads storage.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      cache = null;
      l();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Learned profile; empty during SSR and hydration, real after mount. */
export function useLearnedProfile(): LearnedProfile {
  return useSyncExternalStore(subscribe, getProfile, () => EMPTY);
}

// ---- events ----

type Space = keyof LearnedProfile;
type Delta = { space: Space; key: string; dw: number; name?: string };

function apply(deltas: Delta[]) {
  if (!deltas.length) return;
  const now = Date.now();
  const cur = getProfile();
  const next: LearnedProfile = { fsg: { ...cur.fsg }, fsc: { ...cur.fsc }, kw: { ...cur.kw } };
  for (const d of deltas) {
    const map = next[d.space] as Record<string, Term & { name?: string }>;
    const prev = map[d.key];
    const w = Math.max(0, decayed(prev, now) + d.dw);
    if (w < PRUNE) delete map[d.key];
    else map[d.key] = { w, t: now, ...(d.name || prev?.name ? { name: d.name ?? prev?.name } : {}) };
  }
  // Keep the keyword space bounded: forget the weakest terms.
  const kws = Object.entries(next.kw);
  if (kws.length > MAX_KW) {
    kws.sort((a, b) => decayed(b[1], now) - decayed(a[1], now));
    next.kw = Object.fromEntries(kws.slice(0, MAX_KW));
  }
  commit(next);
}

const rfqDeltas = (r: RfqLike, fscW: number, fsgW: number, kwW: number): Delta[] => [
  ...(r.fsc && /^\d{4}$/.test(r.fsc) ? [{ space: "fsc" as const, key: r.fsc, dw: fscW }] : []),
  ...(r.fsg && /^\d{2}$/.test(r.fsg) ? [{ space: "fsg" as const, key: r.fsg, dw: fsgW, name: r.fsgName ?? undefined }] : []),
  ...tokenize(r.nomenclature ?? "").map((key) => ({ space: "kw" as const, key, dw: kwW })),
];

export function recordSearch(query: string) {
  const deltas: Delta[] = tokenize(query).map((key) => ({ space: "kw", key, dw: 1 }));
  // An NSN (or its leading digits) pins the class and group directly.
  for (const part of query.split(/\s+/)) {
    const digits = part.replace(/[-\s]/g, "");
    if (/^\d{4,}$/.test(digits)) {
      deltas.push({ space: "fsc", key: digits.slice(0, 4), dw: 2 }, { space: "fsg", key: digits.slice(0, 2), dw: 1 });
    }
  }
  apply(deltas);
}

export function recordFilterFsg(code: string, name?: string) {
  if (/^\d{2}$/.test(code)) apply([{ space: "fsg", key: code, dw: 1.5, name }]);
}

export const recordOpen = (r: RfqLike) => apply(rfqDeltas(r, 1, 0.5, 0.5));
export const recordSave = (r: RfqLike) => apply(rfqDeltas(r, 3, 1.5, 2));
export const recordUnsave = (r: RfqLike) => apply(rfqDeltas(r, -3, -1.5, -2));

export function reset() {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  cache = emptyProfile();
  listeners.forEach((l) => l());
}

// ---- compile: top-K terms of the vector -> ifsc / ikw ----

const ranked = <T extends Term>(map: Record<string, T>, now: number) =>
  Object.entries(map)
    .map(([k, v]) => ({ k, v, w: decayed(v, now) }))
    .filter((x) => x.w >= MIN_TERM)
    .sort((a, b) => b.w - a.w);

export function getTop(profile: LearnedProfile, k = { fsg: 3, fsc: 3, kw: 8 }, nowArg?: number): LearnedTop {
  // Only read the clock when there is something to decay: the empty server snapshot must not call Date.now() during prerender.
  const empty = !Object.keys(profile.fsg).length && !Object.keys(profile.fsc).length && !Object.keys(profile.kw).length;
  const now = nowArg ?? (empty ? 0 : Date.now());
  const fsg = ranked(profile.fsg, now);
  const fsc = ranked(profile.fsc, now);
  const kw = ranked(profile.kw, now);
  const sum = (xs: { w: number }[]) => xs.reduce((s, x) => s + x.w, 0);
  const topFsg = fsg.slice(0, k.fsg);
  const topFsc = fsc.slice(0, k.fsc);
  const topKw = kw.slice(0, k.kw);
  const topCategories = [
    ...topFsc.map((x) => ({ code: x.k, label: `Class ${x.k}`, weight: x.w })),
    ...topFsg.map((x) => ({ code: x.k, label: `${x.k} ${FSG_NAMES[x.k] ?? x.v.name ?? "Group"}`, weight: x.w })),
  ].sort((a, b) => b.weight - a.weight);
  return {
    ifsc: [...topFsc.map((x) => x.k), ...topFsg.map((x) => x.k)],
    ikw: topKw.map((x) => x.k),
    strength: sum(fsg) + sum(fsc) + sum(kw),
    topCategories,
    topKeywords: topKw.map((x) => ({ word: x.k, weight: x.w })),
  };
}
