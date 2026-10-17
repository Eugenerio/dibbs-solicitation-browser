// Incremental embedding of item names (server/CLI only). Loads data/embeddings.json, embeds ONLY nomenclature keys not yet
// present, appends them and writes atomically (tmp + rename). Existing keys are never re-embedded.
// Key: OPENAI_API_KEY from env or .env.local. EMBED_FAKE=1 uses deterministic bag-of-words hash vectors (no key, demo only).
// EMBED_OUT overrides the output path (default: EMBEDDINGS_PATH or data/embeddings.json).
import { promises as fs } from "node:fs";
import path from "node:path";
import { fsgName } from "./fsc";
import type { Snapshot } from "./types";

const MODEL = "text-embedding-3-small";
const DIM = 256;
const BATCH = 256;

type Progress = (done: number, total: number, message?: string) => void;

interface EmbeddingsFile {
  model: string;
  dim: number;
  keys: string[];
  vectors: string;
}

const outPath = () =>
  process.env.EMBED_OUT || process.env.EMBEDDINGS_PATH || path.join(process.cwd(), "data", "embeddings.json");

function apiKey(): string | null {
  if (!process.env.OPENAI_API_KEY) {
    try {
      process.loadEnvFile(path.join(process.cwd(), ".env.local"));
    } catch {
      /* no .env.local: fall back to the environment */
    }
  }
  return process.env.OPENAI_API_KEY || null;
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Deterministic pseudo-embedding: word tokens feature-hashed (FNV-1a, signed) into DIM buckets. NOT semantic. */
function fakeEmbed(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    let h = 0x811c9dc5;
    for (let i = 0; i < tok.length; i++) h = Math.imul(h ^ tok.charCodeAt(i), 0x01000193);
    v[(h >>> 0) % DIM] += h & 0x80000000 ? -1 : 1;
  }
  return normalize(v);
}

async function openaiEmbed(inputs: string[], key: string): Promise<Float32Array[]> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, input: inputs, dimensions: DIM }),
    });
    if (res.ok) {
      const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      const out: Float32Array[] = new Array(inputs.length);
      for (const d of body.data) out[d.index] = normalize(Float32Array.from(d.embedding));
      return out;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`OpenAI embeddings failed (${res.status})`); // body omitted: never echo request details
  }
}

async function readExisting(file: string): Promise<{ keys: string[]; vectors: Float32Array }> {
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as EmbeddingsFile;
    const buf = Buffer.from(raw.vectors, "base64");
    const vectors = new Float32Array(buf.byteLength / 4);
    new Uint8Array(vectors.buffer).set(buf);
    if (raw.dim === DIM && vectors.length === raw.keys.length * DIM) return { keys: raw.keys, vectors };
  } catch {
    /* missing or malformed: start fresh */
  }
  return { keys: [], vectors: new Float32Array(0) };
}

export async function embedMissing(opts: { onProgress?: Progress } = {}): Promise<{ added: number; total: number; skipped: boolean }> {
  const progress = opts.onProgress ?? (() => {});
  const fake = process.env.EMBED_FAKE === "1";
  const key = fake ? null : apiKey();
  if (!fake && !key) return { added: 0, total: 0, skipped: true };
  if (fake) console.warn("WARNING: EMBED_FAKE=1 - writing FAKE hash vectors (not semantic). Do not ship them.");

  const file = outPath();
  const snap = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "rfqs.json"), "utf8")) as Snapshot;
  const existing = await readExisting(file);
  const have = new Set(existing.keys);
  const todo = new Map<string, string>(); // nomenclature -> embedded text
  for (const r of snap.rfqs) {
    const nomen = r.nomenclature;
    if (!nomen || have.has(nomen) || todo.has(nomen)) continue;
    const cat = fsgName(r.fsg); // category name disambiguates short cryptic names
    todo.set(nomen, cat ? `${nomen} ${cat}` : nomen);
  }
  if (!todo.size) return { added: 0, total: existing.keys.length, skipped: false };

  const newKeys = [...todo.keys()];
  const added = new Float32Array(newKeys.length * DIM);
  for (let i = 0; i < newKeys.length; i += BATCH) {
    const keys = newKeys.slice(i, i + BATCH);
    const texts = keys.map((k) => todo.get(k)!);
    const vecs = fake ? texts.map(fakeEmbed) : await openaiEmbed(texts, key!);
    vecs.forEach((v, j) => added.set(v, (i + j) * DIM));
    progress(Math.min(i + BATCH, newKeys.length), newKeys.length, "Embedding item names");
  }

  const vectors = new Float32Array(existing.vectors.length + added.length);
  vectors.set(existing.vectors);
  vectors.set(added, existing.vectors.length);
  const keys = [...existing.keys, ...newKeys];
  const body: EmbeddingsFile = {
    model: fake ? `fake-hash-${DIM}` : MODEL,
    dim: DIM,
    keys,
    vectors: Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength).toString("base64"),
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(body));
  await fs.rename(tmp, file);
  return { added: newKeys.length, total: keys.length, skipped: false };
}
