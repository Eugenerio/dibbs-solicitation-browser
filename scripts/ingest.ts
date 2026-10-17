// CLI: npm run ingest -- --days 5
import { ingest } from "../lib/dibbs/ingest";

const i = process.argv.indexOf("--days");
const days = i > -1 ? Number.parseInt(process.argv[i + 1] ?? "5", 10) : 5;

const t0 = Date.now();
let last = "";
ingest({
  days,
  onProgress: (done, total, msg) => {
    const line = `[${done}/${total}] ${msg ?? ""}`;
    if (line !== last) console.log(line);
    last = line;
  },
})
  .then(({ added, total }) => console.log(`✓ ${added} new RFQs, ${total} total in data/rfqs.json (${((Date.now() - t0) / 1000).toFixed(1)}s)`))
  .catch((e) => {
    console.error("Ingest failed:", e);
    process.exit(1);
  });
