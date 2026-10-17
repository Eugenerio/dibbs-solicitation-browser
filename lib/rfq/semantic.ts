// Optional semantic ranking. Item vectors are precomputed offline (scripts/embed.ts -> data/embeddings.json), so runtime
// ranking needs no API key and no network. Completely inert when the file is missing or no anchors are supplied.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Row } from "./store";
import type { Rfq } from "./types";

interface Embeddings {
  dim: number;
  index: Map<string, number>; // nomenclature -> row offset (in vectors, units of dim)
  vectors: Float32Array; // L2-normalized, row-major
}

interface EmbeddingsFile {
  model: string;
  dim: number;
  keys: string[];
  vectors: string; // base64 Float32Array (little-endian)
}

const FILE = () => process.env.EMBEDDINGS_PATH || path.join(process.cwd(), "data", "embeddings.json");

type Cache = { key: string; emb: Embeddings | null };
const g = globalThis as unknown as { __embCache?: Cache };

async function load(): Promise<Embeddings | null> {
  const file = FILE();
  let key: string;
  try {
    const st = await stat(file);
    key = `${file}:${st.mtimeMs}:${st.size}`;
  } catch {
    return null; // no embeddings file: feature off
  }
  if (g.__embCache?.key === key) return g.__embCache.emb;
  let emb: Embeddings | null = null;
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as EmbeddingsFile;
    const buf = Buffer.from(raw.vectors, "base64");
    const vectors = new Float32Array(buf.byteLength / 4);
    new Uint8Array(vectors.buffer).set(buf); // copy: Buffer slices may be unaligned for Float32Array views
    if (raw.dim > 0 && vectors.length === raw.keys.length * raw.dim) {
      const index = new Map<string, number>();
      raw.keys.forEach((k, i) => index.set(k, i));
      emb = { dim: raw.dim, index, vectors };
    }
  } catch {
    emb = null; // malformed file: treat as missing
  }
  g.__embCache = { key, emb };
  return emb;
}

export async function hasEmbeddings(): Promise<boolean> {
  return (await load()) != null;
}

export interface Anchor {
  sol: string;
  w: number;
}

/** "SOL:weight,SOL:weight" -> anchors (max 12, weight clamped to 0.5-5). Garbage pairs are dropped. */
export function parseAnchors(raw: string | null): Anchor[] {
  if (!raw) return [];
  const out: Anchor[] = [];
  for (const part of raw.split(",")) {
    const i = part.lastIndexOf(":");
    const sol = (i > 0 ? part.slice(0, i) : part).trim();
    const w = i > 0 ? Number(part.slice(i + 1)) : 1;
    if (!sol || !Number.isFinite(w)) continue;
    out.push({ sol, w: Math.min(5, Math.max(0.5, w)) });
    if (out.length >= 12) break;
  }
  return out;
}

export interface Taste {
  centroid: Float32Array;
  anchorLabels: { sol: string; nomen: string; vec: Float32Array }[];
}

function vecOf(emb: Embeddings, nomen: string): Float32Array | null {
  const i = emb.index.get(nomen);
  return i == null ? null : emb.vectors.subarray(i * emb.dim, (i + 1) * emb.dim);
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Weighted centroid of the anchors' vectors, L2-normalized. null when no anchor has a vector. */
export function buildTaste(emb: Embeddings, anchors: Anchor[], rowsBySol: (sol: string) => Rfq | undefined): Taste | null {
  const centroid = new Float32Array(emb.dim);
  const anchorLabels: Taste["anchorLabels"] = [];
  for (const a of anchors) {
    const nomen = rowsBySol(a.sol)?.nomenclature;
    const vec = nomen ? vecOf(emb, nomen) : null;
    if (!nomen || !vec) continue;
    for (let i = 0; i < emb.dim; i++) centroid[i] += a.w * vec[i];
    anchorLabels.push({ sol: a.sol, nomen, vec });
  }
  let n = 0;
  for (let i = 0; i < emb.dim; i++) n += centroid[i] * centroid[i];
  if (!anchorLabels.length || n === 0) return null;
  n = Math.sqrt(n);
  for (let i = 0; i < emb.dim; i++) centroid[i] /= n;
  return { centroid, anchorLabels };
}

// Cosines between unrelated items sit around 0.1-0.25 for text-embedding-3-small, so anything at or below this floor
// earns nothing and the remaining range (0.25-1) is stretched to 0-1.
const COS_FLOOR = 0.25;

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[^a-z0-9'])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());

/** Per-request semantic context. Scores are memoized per unique nomenclature, so a request is O(unique * dim). */
export interface Semantic {
  semanticScore(row: Row): number; // [0,1]
  nearestAnchor(row: Row): string | null; // nomenclature of the most similar anchor
  bonus(row: Row): number; // integer points added to the match score
  reason(row: Row): string | null;
}

function makeSemantic(emb: Embeddings, taste: Taste): Semantic {
  const scores = new Map<string, number>();
  const semanticScore = (row: Row): number => {
    const nomen = row.rfq.nomenclature;
    if (!nomen) return 0;
    let s = scores.get(nomen);
    if (s === undefined) {
      const v = vecOf(emb, nomen);
      s = v ? Math.max(0, dot(v, taste.centroid) - COS_FLOOR) / (1 - COS_FLOOR) : 0;
      scores.set(nomen, s);
    }
    return s;
  };
  const nearestAnchor = (row: Row): string | null => {
    const v = row.rfq.nomenclature ? vecOf(emb, row.rfq.nomenclature) : null;
    if (!v) return null;
    let best: string | null = null, bestCos = -Infinity;
    for (const a of taste.anchorLabels) {
      const c = dot(v, a.vec);
      if (c > bestCos) { bestCos = c; best = a.nomen; }
    }
    return best;
  };
  const bonus = (row: Row) => Math.round(6 * semanticScore(row));
  const reason = (row: Row): string | null => {
    if (bonus(row) <= 0) return null;
    const n = nearestAnchor(row);
    return n ? `Similar to: ${titleCase(n)}` : null;
  };
  return { semanticScore, nearestAnchor, bonus, reason };
}

const solIndex = new WeakMap<Row[], Map<string, Rfq>>();

/** Semantic context for a request's `sem` param, or null (no param, no embeddings, or no usable anchors). */
export async function getSemantic(raw: string | null, rows: Row[]): Promise<Semantic | null> {
  const anchors = parseAnchors(raw);
  if (!anchors.length) return null;
  const emb = await load();
  if (!emb) return null;
  let bySol = solIndex.get(rows);
  if (!bySol) {
    bySol = new Map(rows.map((r) => [r.rfq.solNumber, r.rfq]));
    solIndex.set(rows, bySol);
  }
  const m = bySol;
  const taste = buildTaste(emb, anchors, (sol) => m.get(sol));
  return taste ? makeSemantic(emb, taste) : null;
}
