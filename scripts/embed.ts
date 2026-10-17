// CLI: npm run embed   (package.json script: "embed": "tsx scripts/embed.ts")
// Incrementally embeds item names into data/embeddings.json (only names not already present). Ingest runs this too.
// Needs OPENAI_API_KEY in .env.local or env. EMBED_FAKE=1 writes fake hash vectors (no key); EMBED_OUT=<path> overrides output.
import { embedMissing } from "../lib/rfq/embed";

const t0 = Date.now();
embedMissing({ onProgress: (done, total) => console.log(`[${done}/${total}] embedded`) })
  .then(({ added, total, skipped }) => {
    if (skipped) console.log("Skipped: OPENAI_API_KEY not set (put it in .env.local) and EMBED_FAKE not set.");
    else console.log(`${added} new vectors, ${total} total (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  })
  .catch((e) => {
    console.error("Embed failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
