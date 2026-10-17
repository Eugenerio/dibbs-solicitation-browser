# Architecture and decisions

Written so the author can explain it out loud. Numbers marked "measured" come from this repo's committed snapshot on a dev laptop; anything marked "estimate" is back-of-envelope.

## 1. Problem framing and the vendor persona

**Persona.** A small defense supplier: a few people, one owner who also does the quoting. They make or source a narrow set of parts (say connectors, straps, valves). Their morning job is: "Which of today's RFQs can I actually quote, and which ones will I lose if I wait?"

**The raw material.** The U.S. Defense Logistics Agency posts RFQs on DIBBS every weekday: roughly 1.5k per issue day in our snapshot (10,658 rows over 7 issue days), and the listings run 1k to 5k per day. Each RFQ is usually one part, identified by an NSN (13 digits: 4-digit supply class, 2-digit country code, 7-digit item number). DIBBS is a lookup tool: ASP.NET grids, 50 rows a page, one date at a time, a consent banner first. There is no cross-day search, no "ranked by what I sell", and it is slow to triage.

**What the vendor needs, in order.**
1. Scan fast: one dense list, sorted by what expires first.
2. Cut the noise: filter by the things that decide "can I and should I quote this".
3. Find what is theirs: rank by their product categories without having to build queries.
4. Hand off cleanly: one click back to the real DIBBS page to read the package and submit the quote.

The app does not try to replace DIBBS. It is the triage layer in front of it.

## 2. Architecture

```
 DIBBS  https://www.dibbs.bsm.dla.mil
 ------------------------------------------------------------------------------
  GET /rfq/  -> redirect to dodwarning.aspx (DoD consent banner)
  POST banner form (butAgree=OK)  -> session cookie
  GET  /Rfq/RfqDates.aspx?category=issue        -> list of issue dates
  GET  /RFQ/RfqRecs.aspx?category=issue&TypeSrch=dt&Value=MM-DD-YYYY
       -> ASP.NET GridView, 50 rows/page
       -> paging = POST __doPostBack('...grdRfqSearch','Page$N') echoing __VIEWSTATE etc.
                |
                |  node:https (the F5 WAF rejects undici/fetch headers)
                v
 lib/dibbs  (scraper; runs from `npm run ingest` or POST /api/refresh)
   client.ts   cookie jar, manual redirects, consent, retry x3 with backoff, WAF-page detection
   parse.ts    cheerio: grid rows -> Rfq (pure function, no network)
   ingest.ts   3 issue-day chains in parallel (own session each), merge by solNumber,
               drop rows closed > 14 days, atomic write (tmp file + rename)
                |
                v
 data/rfqs.json   snapshot { refreshedAt, issueDates, rfqs[] }   (committed; works offline)
                |
                |  store.ts: parse once, build row index (lowercase haystack, return-day number),
                |  cache in module memory keyed by file mtime:size -> picks up new ingests, no restart
                v
 lib/rfq  (in-memory query engine, pure functions)
   query.ts    one pass computes a "failed filters" bitmask per row
               list   = rows with mask 0, then score, sort, paginate
               facets = rows whose mask is 0 ignoring the facet's own bit
               interest scoring + match reasons
                |
                v
 app/api/*  Next route handlers (thin): rfqs, facets, meta, refresh
   parseFilters(URLSearchParams)  <- the same codec the UI uses to write the URL
                |
                v   JSON, no-store
 React UI  (app/page.tsx + components/*, shadcn/ui on Base UI)
   state = filters in the URL (replaceState) + interests/saved in localStorage
   hooks/use-rfqs: debounce, AbortController, keep-previous-data, parallel list+facets+counts
```

One contract (`lib/rfq/types.ts`) and one URL codec (`lib/rfq/params.ts`) sit between the layers, so the scraper, engine, API and UI could be built and changed independently.

## 3. Key decisions and trade-offs (50-minute budget)

**Next.js, full-stack TypeScript.** One repo, one language, shared types, route handlers for the API and a React UI. Fewer moving parts to demo and deploy. Trade-off: the scraper lives in the same codebase as the web app; in production it would be a separate scheduled job.

**JSON snapshot plus in-memory filtering, no database.**
- Why: the whole problem is "filter and sort a few thousand to tens of thousands of small rows". An O(n) pass over an in-memory array is simple, has no infrastructure, and is fast. Measured: `/api/rfqs` and `/api/facets` answer in about 10 to 20 ms warm on the ~10k-row snapshot (a few single curl requests on a dev laptop, not a benchmark).
- Why it is safe: the file is written atomically (tmp file then rename) and the loader falls back to the last good copy if the file is mid-write or unreadable, so readers never see a half-written snapshot.
- Where it stops: the file is about 7.6 MB for ~10.6k rows (about 700 bytes per row), so roughly 100k rows means a ~70 MB file and a few hundred MB of heap (estimate). That is the ceiling. Past it: Postgres with `tsvector` for full-text search, `pg_trgm` for NSN fragments and typos, indexes on return-by date, supply class and set-aside, scheduled ingestion, and history.
- Honest cost: single process, no history (rows are dropped 14 days after they close), no concurrent writers.

**Server-side filtering, sorting and pagination.** The browser never holds the dataset. A 50-row page is about 39 KB (measured: 38,863 bytes) instead of the multi-MB file, first paint is fast, and filter changes are one small request. Facet counts also need the full set, which only the server has.

**Facets exclude their own selection.** If you pick "SDVOSB", the set-aside list still shows HUBZone and Small Business with the counts you would get by switching. Otherwise options vanish and you cannot compare. Implementation trick: each row gets a bitmask of which filters it fails; a facet counts rows where `mask & ~ownBit == 0`. One pass over the data serves the list and all facets.

**URL as state.** Every filter, sort and page is in the query string, written with `replaceState` (so Back does not replay every keystroke). A vendor can paste a search to a colleague. Not in the URL, on purpose: the interests profile (personal, kept in localStorage and sent to the stateless server as `ifsc` / `ikw` per request) and saved items.

**Scrape the listing pages, not each solicitation page.** One request returns 50 rows, and the listing already carries everything needed for triage: NSN, item name, quantity, dates, set-aside, fast-award flag, tech-docs flag. Per-solicitation pages would be one request per row (thousands) for fields a vendor reads once they have decided to look. Cost: no description, delivery location or approved sources in our table; that is what **Open on DIBBS** is for.

**shadcn/ui for every primitive.** Table, sheet, select, checkbox, switch, toggle group, command, tooltip are all shadcn (on Base UI), so keyboard and screen-reader behavior comes for free and the time went into the data and the filters. Trade-off: Base UI uses a `render` prop instead of Radix's `asChild`, so examples from other projects do not paste in.

**Stability and speed details worth mentioning.**
- Scraper: retry three times with exponential backoff, detect the WAF's "Request Rejected" page, follow redirects manually so cookies set on a 302 are kept, a 120-page safety valve per day, stop when a page adds no new rows, merge by solicitation number with fresh data winning.
- UI: 200 ms search debounce, `AbortController` cancels superseded requests, previous results stay on screen while refetching, skeletons on first load, error state with retry, facets failing never blocks the list.
- Dates: `daysLeft` is computed at request time, not stored, so a snapshot committed on Friday still hides expired RFQs on Monday.

**Thought process (a narrative that matches how the code is shaped).** Start from the source, not the UI: DIBBS puts a consent interstitial in front, plain `fetch` gets a WAF "Request Rejected" page while `node:https` with browser-like headers works, and paging is a form postback that needs the hidden ASP.NET fields echoed back. Only then pick the data model: since the source is a daily batch, a snapshot is the natural shape; the product question became "what does a vendor do with 1.5k rows?", which led to the filters and the ranked "For you" view.

## 4. Why these filters

Each filter exists because it answers a decision a vendor makes. Defaults are chosen so the first screen is already useful: open RFQs only, soonest deadline first.

| Filter | Vendor decision it supports |
| --- | --- |
| Closing soon (today, 3, 7, 14 days) | "Can I still respond?" Triage by deadline. Default sort is closing soonest, closed RFQs hidden unless asked. |
| Set-aside (small business, HUBZone, SDVOSB, WOSB, EDWOSB, combined, unrestricted) | Eligibility. If an RFQ is reserved for a status you do not hold, you cannot bid; if it is reserved for yours, competition is narrower. This is a hard gate, so it is multi-select with counts. |
| Category = federal supply group (first 2 digits of the NSN) | "Is this something I make or supply?" Derived from the NSN, so it needs no extra data. Searchable list with counts. |
| Fast award candidate | DIBBS flags RFQs that may be awarded before the return date (micro-purchases). Meaning: quote early or lose it. |
| Has technical docs | Drawings or specs are attached. A build-to-print part cannot be priced without them, and it separates commodity items from engineered ones. |
| Quantity range | Capacity and margin. Tiny lots may not be worth the quoting effort; huge ones may exceed what the shop can make. Shows the range present in the current view. |
| Issue date | The daily workflow: "what is new today" or "catch up since Friday". |
| Show closed | Research and pricing context on expired RFQs. Off by default. |
| Search (NSN with or without dashes, solicitation #, item, PR #) | Direct lookup when the vendor already knows the part or the number from an email. Tokens are ANDed. |

**Deliberately not built.** Price or estimated value (DIBBS does not publish it on the listing), buyer or agency, delivery location, approved sources, NAICS. Those are on the detail page or in other systems, and they belong in the roadmap, not in a 50-minute build.

## 5. Interests: learned from behavior, nothing to fill in

Filtering is the baseline; ranking is the part that saves the most time. The vendor never fills in a profile. The app learns it:

| Event | Effect on the profile |
| --- | --- |
| Search text (after a pause) | keywords from the query; an NSN-like query adds its supply class and group |
| Supply-group filter checked | that group |
| RFQ opened (detail drawer) | its supply class and group, plus keywords from the item name |
| RFQ saved (unsaved reverses it) | the strongest signal: class, group and item-name keywords |

The profile is a **sparse interest vector** over two spaces, categories (2-digit groups, 4-digit classes) and item-name keywords. Weights decay with a 14-day half-life, so the profile follows the vendor's current focus. It lives in the browser only (localStorage), so there are no accounts and nothing to send anywhere. "Your profile" shows what was learned and has a Reset button, so the ranking stays explainable. Manual pins ("Pin interests", optional) are merged in for vendors who want to steer it.

The client compiles the top of that vector (3 groups, 3 classes, 8 keywords, only once total weight passes a threshold) into `ifsc` and `ikw` request parameters. The server scores each row (`scoreRow` in `lib/rfq/query.ts`):

| Signal | Points |
| --- | --- |
| NSN's 4-digit supply class is in the profile | +3 |
| NSN's 2-digit supply group is in the profile | +2 |
| Each keyword found at the start of a word in the item name | +2 |
| Fast-award candidate, only if the row already matched something | +1 |

Rows with score 0 are not matches. "Best match" sorts by score, then closest deadline. The **For you** tab is "matches only" plus that sort. Every row carries `matchReasons` ("Category 59", "Keyword: valve", "Similar to: ...") shown as chips, so the ranking explains itself.

**Semantic layer (optional, off until vectors exist).** Keywords miss synonyms ("bolt, hex" vs "screw, cap"). So item names are embedded once with OpenAI `text-embedding-3-small` (256 dimensions, about 3.6k unique names, pennies). The vectors are precomputed offline and stored in `data/embeddings.json`, so ranking needs **no API key and no network call at request time**. The vendor's taste vector is the weighted centroid of the RFQs they saved or opened; every row gets cosine similarity to it, added to the score with a reason chip "Similar to: ...". If the file is missing, the layer is inert. Each scrape embeds only the **new** item names (incremental), at the end of the ingest, and a missing key or API error never fails a scrape.

**Trade-offs.**
- Cold start: a new vendor sees the normal list plus a hint; one save is enough to start ranking. Pins or a first search help immediately.
- Filter bubble: "For you" is a separate tab from "All RFQs", and weights decay, so the odd RFQ outside past behavior is never hidden.
- Privacy and simplicity: the profile never leaves the browser. The cost is that it does not follow the vendor across devices; with accounts it would move server-side.
- Explainability beats a black box for a first version: every score is a sum of named signals.

**Next steps.** Weight by quotes submitted and awards won ("we won this NSN before"); embed free-text queries at request time (needs the key at runtime) and use pgvector for nearest-neighbour search at scale; saved searches and a daily email or Slack digest of new matches; server-side profiles once there are accounts.


## 6. Scraping politeness and the legal caveat

**What the app does to be a reasonable client.** Low concurrency (three issue-day chains at a time, a keep-alive agent capped at six sockets), retries with exponential backoff instead of hammering, one listing request per 50 rows (not per solicitation), a hard cap on pages per day, and a local snapshot so the UI never touches DIBBS per user action. The UI's refresh is a single-flight job per server process.

**What to be upfront about.**
- This is public procurement data that DLA publishes so vendors can bid.
- DIBBS shows a DoD Warning and Consent banner first. The scraper accepts it programmatically by posting the banner's form, the same as a human clicking OK. That is a judgment call that should be confirmed with whoever owns the compliance question (the interviewer, a company lawyer) before any production use.
- To pass the WAF the client sends a browser-like `User-Agent` and `Accept` headers. For production the right move is to ask DLA about an official bulk feed or sanctioned access, and to send an honest, identifying user agent with a contact address.
- Not verified in this build: `robots.txt` and any written terms of use for automated access. Check both before running this beyond a demo.

## 7. Limitations and roadmap

**Limitations (honest list).**
- No automated tests. The parser and the query engine are pure functions, so tests are cheap to add.
- No scheduled ingestion; data is as fresh as the last manual or button-triggered refresh.
- `POST /api/refresh` is unauthenticated, runs in-process and writes to local disk. It works on a long-running Node server; it would not work on serverless hosting or a read-only filesystem, and should not be public as is.
- Single JSON file, no history: rows are dropped 14 days after they close, so there is no trend or award data.
- Saved items and the interests profile live in one browser (localStorage); no sync across devices, no accounts.
- Search is substring matching: no typo tolerance, no relevance ranking.
- Category filter lists the top 40 supply groups for the current view and only searches within those; a rare group is reachable through the interests panel or the URL.
- Items whose "NSN" is a plain part number (not a 13-digit NSN) have no supply group or class, so they never match category filters or class-based interests.
- Set-aside is inferred from the icon alt text DIBBS shows (unknown alt text falls back to "other"); multiple icons collapse to "combined".
- "Today" and days-left use the UTC date; right around midnight US time a deadline can look one day off.
- The scraper depends on DIBBS markup. The parser is isolated and fails loudly (for example "returned no issue dates"), but there are no fixture tests or alerting yet.

**Roadmap.**
1. Postgres: `rfq` table keyed by solicitation number, `tsvector` and `pg_trgm` indexes, indexes on return-by date, supply class, set-aside; idempotent upserts.
2. Scheduled ingestion (cron or a queue after DIBBS posts for the day), an ingestion-runs table, alerts when row counts drop abnormally.
3. History per NSN: how often it is bought, past quantities and, where available, award prices. This is the most valuable missing piece for "is it worth quoting".
4. Accounts, server-side profiles, saved searches, email or Slack alerts.
5. Better matching: learn from stars and quotes, embeddings on item names.
6. Tests: parser fixtures from saved HTML, engine tests (including "facet counts agree with list totals"), a Playwright smoke test.
7. Per-solicitation enrichment on demand (description, delivery, approved sources), cached.

## 8. Three-minute demo script

Pre-flight: run `npm run dev`, load the page once so the snapshot is warm. Do not click **Refresh from DIBBS** live unless the network is known good; the committed snapshot is the safe path.

| Time | Do | Say |
| --- | --- | --- |
| 0:00 | Open the app | "Every weekday DLA posts about 1.5k RFQs on DIBBS. A small vendor needs to know in a minute which ones to quote. This is the triage layer in front of DIBBS." |
| 0:20 | Type `valve`, then an NSN with dashes; press `/`, `j`, `k` | "One search box for NSN, solicitation, item, PR. Debounced, and it stays on the old rows while it loads, no flicker. Keyboard works." |
| 0:50 | Click "Closing soon: ≤ 7 days", add a set-aside (SDVOSB or Small Business), toggle Fast award | "Each filter is a decision: can I still respond, am I eligible, do I need to move before the deadline. Counts update under the current filters, and options never vanish. The URL is the state, so I can paste this search to someone." (Copy the URL.) |
| 1:30 | Search `valve`, open two valve RFQs, **Save** one | "Nothing to configure. Searches, filters, opens and saves feed a sparse interest vector with time decay, kept in the browser. Open **Your profile** to see what it learned." |
| 2:00 | Show **For you** tab | "Only matches, best first, and each row says why: Category 48, Keyword: valve. Class +3, group +2, keyword +2, fast award +1. Optional embeddings add 'Similar to ...' without any request-time API call. Separate tab from All RFQs, so it never hides anything." |
| 2:20 | Click a row, then **Open on DIBBS** | "Every row opens its original DIBBS page. The drawer has the PDF, the NSN page and the quote link." Star it; show the **Saved** tab. |
| 2:40 | Point at the header | "Data comes from a scraper I wrote: consent banner, per-day listings, ASP.NET postback paging, `node:https` because the WAF rejects fetch. It writes a JSON snapshot; the engine filters in memory in roughly 10 to 20 ms. At scale: Postgres, scheduled ingest, history." |
| 3:00 | Stop | |
