# Solicitation Browser

A fast, focused way for small defense vendors to scan the **DLA RFQs** posted on [DIBBS](https://www.dibbs.bsm.dla.mil/rfq/), search them, filter down to what is worth quoting on, and jump to any row's original DIBBS page.

Every weekday the U.S. Defense Logistics Agency posts hundreds to thousands of RFQs (requests for quotation, usually for a part identified by an NSN). DIBBS is built for lookup, not for triage. This app scrapes the daily listings into a local snapshot and puts a quick, filterable, rankable UI on top.

Stack: Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui (Base UI primitives). No database. Scraper: `node:https` + cheerio.

## Quickstart

```bash
npm i
npm run ingest -- --days 7   # optional: scrape the last 7 DIBBS issue days live (default 5, max 30)
npm run dev
# open http://localhost:3000
```

A snapshot (`data/rfqs.json`, about 10k RFQs across 7 issue days at the time of writing) is committed, so the app works offline and `npm run ingest` is optional. You can also refresh from the UI with the **Refresh from DIBBS** button (same code path).

Requires a recent Node (20+). Ingest needs outbound HTTPS to `www.dibbs.bsm.dla.mil`.

Other scripts: `npm run build`, `npm start`, `npm run lint`.

## Features

**Browse**
- Dense, sortable results table on desktop; card list on mobile. Skeleton loading, inline error with retry, no flicker while refetching (previous rows stay on screen).
- Per-row signals at a glance: days left to quote (red/amber/neutral), set-aside badge, fast-award bolt, tech-docs icon, quantity, supply group.
- Detail drawer with every field, plus **Open on DIBBS** (Package View), the RFQ PDF, the NSN page, and the quote link.
- Sort: Closing soonest (default), Newest, Quantity, Item name, Best match.
- Keyboard: `/` focus search, `j`/`k` move, `Enter` details, `o` open on DIBBS, `s` save.

**Search**
- One box, tokens are ANDed. Matches NSN (with or without dashes), solicitation number, item name, PR number. Debounced, and superseded requests are aborted.

**Filters** (all with live counts, computed excluding the facet's own selection so options never disappear)
- Closing soon: today, within 3, 7, 14 days
- Set-aside: unrestricted, small business, HUBZone, SDVOSB, WOSB, EDWOSB, combined
- Category: federal supply group (first 2 digits of the NSN), searchable
- Fast award candidates, has technical docs, show closed
- Issue date, quantity range
- Active-filter chips, Clear all, and the full state lives in the URL so any search is shareable

**For you (learned interests, nothing to fill in)**
- The app learns what the vendor cares about from what they search, filter on, open and save (sparse interest vector over supply groups/classes and item-name keywords, 14-day decay, stored in the browser). Every RFQ is scored against it; the **For you** tab shows only matches, ranked, with reason chips ("Category 59", "Keyword: connector", "Similar to: ..."). "Your profile" shows what was learned and can be reset; "Pin interests" is an optional manual override.
- Optional semantic layer: item names are embedded with OpenAI `text-embedding-3-small` (`npm run embed`, incremental, also run at the end of every scrape when `OPENAI_API_KEY` is in `.env.local`). Ranking then also uses cosine similarity to the items the vendor saved or opened, with no API call at request time. Without the vector file it is simply off.

**Saved**
- Save RFQs; they stay in a **Saved** tab (browser storage) even after they drop off the daily feed.

## API

All endpoints return JSON with `Cache-Control: no-store`. Filters use one query-string codec shared by server and UI (`lib/rfq/params.ts`), and only non-default values are emitted.

| Endpoint | Purpose | Notes |
| --- | --- | --- |
| `GET /api/rfqs?<filters>` | Filtered, sorted, paginated list. Returns `ListResponse` (`items`, `total`, `page`, `pageSize`, `pages`). | Each item is an `RfqView` (adds `fsgName`, `daysLeft`, and `score` / `matchReasons` when interests are sent). |
| `GET /api/facets?<filters>` | Counts for set-aside, supply group (top 40), closing buckets, fast award, tech docs, issue dates, quantity range. Returns `FacetsResponse`. | Each facet is counted under the current filters except its own selection. |
| `GET /api/meta` | `refreshedAt`, `total`, `open`, `issueDates`, `source`, `today`. | Drives the "N open RFQs, updated X ago" header. |
| `POST /api/refresh` | Start a background re-scrape of DIBBS. Body `{ "days"?: 1-30 }`. Returns `202` + `RefreshStatus`. | One refresh at a time per server process; a second POST returns the running status. |
| `GET /api/refresh` | Poll refresh progress (`running`, `progress`, `added`, `totalRfqs`, `error`). | The UI polls every 1.5 s, then reloads the list. |

Filter parameters:

| Param | Meaning | Example |
| --- | --- | --- |
| `q` | Free text (tokens ANDed) | `q=8465-01 strap` |
| `fsg` / `fsc` | Supply group (2 digits) / class (4 digits), comma-separated | `fsg=59,58` |
| `aside` | `unrestricted,small_business,hubzone,sdvosb,wosb,edwosb,combined,other` | `aside=sdvosb,hubzone` |
| `fast`, `docs`, `closed` | `1` to enable (fast-award only, has tech docs, include closed) | `fast=1` |
| `closes` | Closes within N days (0 = today) | `closes=7` |
| `from`, `to` | Issued date range, `yyyy-mm-dd` | `from=2026-10-16&to=2026-10-16` |
| `qmin`, `qmax` | Quantity range | `qmin=100` |
| `sort` | `closing` (default), `newest`, `qty`, `item`, `match` | `sort=match` |
| `page`, `size` | 1-based page; page size (default 50, max 200) | `page=2` |
| `ifsc`, `ikw` | Interests profile: 2- or 4-digit prefixes / keywords, comma-separated | `ifsc=59,5935&ikw=connector` |
| `matches` | `1` = only rows with a positive interest score | `matches=1` |

Example: `/api/rfqs?closes=7&fast=1&aside=small_business&ifsc=59&ikw=connector&sort=match`

## Project layout

```
app/
  page.tsx                 client page: URL + localStorage state, tabs, wiring
  layout.tsx               fonts, tooltip provider
  api/
    rfqs/ facets/ meta/    read endpoints (thin: parse params -> lib/rfq -> JSON)
    refresh/               POST starts a background scrape, GET polls status
    _json.ts               no-store JSON helper
components/
  top-bar, filter-sidebar, results-table, detail-drawer, interests-panel,
  active-filters, pagination-bar, badges     feature components
  ui/                      shadcn/ui primitives (Base UI based)
lib/
  rfq/
    types.ts               shared contract (Rfq, RfqFilters, responses)
    params.ts              the one URL <-> filters codec (server and UI)
    store.ts               snapshot loader + in-memory index, cached by file mtime
    query.ts               filters, sort, facets, interest scoring (pure functions)
    fsc.ts                 supply group code -> name
  dibbs/
    client.ts              node:https client: cookie jar, consent, retries, redirects
    parse.ts               pure HTML -> Rfq parsing (cheerio), no network
    ingest.ts              orchestration: issue dates -> paged listings -> merge -> atomic write
  ui/                      hooks (use-rfqs), localStorage helpers, formatters
scripts/ingest.ts          CLI wrapper for lib/dibbs/ingest
data/rfqs.json             committed snapshot (never hand-edited)
docs/ARCHITECTURE.md       design, trade-offs, why these filters
docs/DEMO.md               demo talking points and Q&A
```

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): problem framing, architecture, decisions and trade-offs, why these filters, how "My interests" works, scraping politeness, limitations, roadmap, demo script.
- [`docs/DEMO.md`](docs/DEMO.md): talking points and likely interviewer questions with answers.

## Status and caveats

- No automated tests (time-boxed take-home). The parser and query engine are pure functions, so fixture and unit tests are the obvious first addition.
- Data is a JSON snapshot loaded into memory; there is no scheduled ingestion. See the roadmap in the architecture doc.
- `POST /api/refresh` is unauthenticated and writes to local disk, so it is a demo convenience for a long-running Node server, not something to expose publicly as is.
- The scraper accepts the DoD consent banner programmatically, the same way a browser click does. Confirm that is acceptable for your use before running it at scale.
