# Demo notes

Companion to `docs/ARCHITECTURE.md` (which has the timed 3-minute script). This file has the talking points and likely questions. Keep answers spoken-length: say the first two sentences, go deeper only if asked.

## The pitch in 20 seconds

"Every weekday DLA posts about 1.5k RFQs on DIBBS. A small vendor has to work out in a few minutes which ones to quote. I built the triage layer in front of DIBBS: scrape the daily listings, scan and search them fast, filter by the decisions a vendor actually makes, and rank by what they supply. Every row opens the original DIBBS page."

## What the interviewers said they care about, and where to point

| They look for | Show / say |
| --- | --- |
| UX, stability, speed | Search debounced, old rows stay while loading, skeletons, error with retry, keyboard (`/`, `j`, `k`, `Enter`, `o`, `s`), mobile cards plus filter sheet. API answers in roughly 10 to 20 ms on ~10k rows; a page is ~39 KB. Scraper retries, atomic file write, last-good-copy fallback. |
| Filter choices | Table in section 4 of the architecture doc: each filter maps to a vendor decision (deadline, eligibility, can I make it, speed, drawings, capacity, freshness). Counts exclude the facet's own selection. |
| Problem-solving | Started from the source: consent banner, WAF that rejects `fetch`, ASP.NET postback paging. Chose a snapshot because the source is a daily batch. Scraped listings, not per-solicitation pages, because the listing already has the triage fields. |
| Product sense | Defaults that are useful on first load (open only, soonest first). "For you" ranking with visible reasons. Saved tab. Hand-off to DIBBS for the actual quote. Honest about what is not there (price, award history). |

## Talking points, in order

1. **Persona and job to be done.** Small supplier, one person quoting. Question: "Which of these can I quote, and which will I lose if I wait?"
2. **Browse first.** Dense table sorted by deadline, badges for days left, set-aside, fast award, tech docs. Open the drawer, then **Open on DIBBS**.
3. **Filters are decisions.** Say the decision, then the filter: deadline, eligibility (set-aside), "can I make it" (supply group), "move fast" (fast award), "can I price it" (tech docs), capacity (quantity), freshness (issue date).
4. **Ranking is the bonus.** The vendor fills in nothing: the app learns an interest profile from searches, filters, opens and saves, with time decay. Additive score, visible reasons. "Your profile" shows what it learned and can be reset.
5. **Data pipeline.** Consent banner, per-day listings, postback paging, `node:https` because of the WAF, cheerio parse, three days in parallel, atomic write.
6. **Why no database.** Daily batch, tens of thousands of rows, O(n) filtering in memory is fast and has no infrastructure. State the ceiling and the next step.
7. **Be upfront about gaps.** No tests, no scheduled ingest, unauthenticated refresh endpoint, no price or award history.

## Likely questions and answers

**Why no database?**
The data is a daily batch of small rows, and every query is a filter plus a sort. An in-memory pass over ~10k rows takes 10 to 20 ms, which beats the complexity of running a database for a prototype. The file is written atomically and the loader falls back to the last good copy. The limit is roughly 100k rows (a ~70 MB file, my estimate). Then it becomes Postgres with `tsvector` for search, `pg_trgm` for NSN fragments and typos, and indexes on return-by date, supply class and set-aside.

**How would you scale it to many users and much more data?**
Move ingestion out of the web process into a scheduled job writing to Postgres. Keep the API stateless and cache facet counts for the unfiltered view. Add a read replica or a search index (Postgres full-text first, a search engine only if needed). Per-user profiles and saved items move server-side with accounts. The UI does not change because it only talks to `/api/*`.

**How do you keep the data fresh?**
Today: `npm run ingest` or the Refresh button (it scrapes the latest N issue days, merges by solicitation number with fresh data winning, and drops rows 14 days after they close). In production: a cron after DIBBS posts for the day, idempotent upserts, an ingestion-runs table, and an alert if the row count for a day looks wrong.

**What happens when DIBBS changes its HTML?**
Parsing is isolated in `lib/dibbs/parse.ts` as a pure function, and it fails loudly (for example "DIBBS returned no issue dates"). I would add fixture tests from saved pages and an alert on parse counts. Today there are no fixture tests, so a change would be caught by a failed ingest, not by CI.

**Why `node:https` instead of `fetch`?**
DIBBS sits behind an F5 WAF that returns a "Request Rejected" page for undici's default header set. A plain `node:https` request with browser-like `User-Agent`, `Accept` and `Accept-Language` is accepted. It also lets me manage cookies and follow redirects myself, which matters because the consent cookie is set on a redirect.

**Is scraping this legal or ethical?**
It is public procurement data published so vendors can bid. The client is deliberately gentle: three concurrent day chains, backoff, one request per 50 rows, and a local snapshot so users never trigger scraping. Two things to be upfront about. The DoD consent banner is accepted programmatically, like a click, and that should be confirmed with whoever owns compliance. And I did not check `robots.txt` or written terms. For production I would ask DLA for an official feed or sanctioned access and send an honest, identifying user agent.

**How does the recommendation work?**
Nothing to configure. Every search, supply-group filter, opened RFQ and saved RFQ updates a sparse interest vector (supply groups and classes, plus item-name keywords) with a 14-day half-life, kept in the browser. The top of that vector is sent with each request; the server scores each RFQ: +3 for a matching 4-digit class, +2 for a 2-digit group, +2 per keyword at the start of a word in the item name, +1 for fast-award when it already matched. "For you" shows score above zero, best first, with reasons as chips.

**Is it using embeddings?**
There is an optional semantic layer. Item names (about 3.6k unique) are embedded once with `text-embedding-3-small` and stored in `data/embeddings.json`; each scrape embeds only the new names. At request time there is no API call: the vendor's taste vector is the weighted centroid of what they saved or opened, and rows are scored by cosine similarity. It catches synonyms the keyword model misses. If the file is missing, it is simply off.

**Isn't learning from behavior a cold-start problem?**
Yes, so a new vendor sees the normal list plus a hint, and a single save starts the ranking. Optional pins give a head start. "For you" is a separate tab from "All RFQs" and weights decay, so it cannot hide the odd opportunity or lock the vendor in. The profile stays in the browser, which is also why it does not follow them across devices until there are accounts.

**What would you add with two more hours?**
In order: scheduled ingestion plus a small test suite (parser fixtures, and an engine test that facet counts agree with list totals); then saved searches with a daily digest of new matches; then lock down the refresh endpoint. The bigger step after that is NSN history (how often it is bought, past quantities and prices), because "is it worth quoting" depends on it.

**Which filters did you consider and drop?**
Price or estimated value (not on the DIBBS listing), buyer or agency, delivery location, NAICS, approved sources. They live on the detail pages or in other systems, so including them would mean scraping per solicitation. I chose to ship the fields the listing already provides and list the rest as roadmap.

**How do you test this?**
There are no automated tests; I should say so plainly. Where I would start: parser fixtures from saved HTML, engine tests (a filter followed by facets must agree with the list total; scoring cases), and a Playwright smoke test of search, filter, For you and Open on DIBBS.

**Security?**
No server-side user data and no auth, so the attack surface is small. React escapes rendered text and external links use `rel="noopener noreferrer"`. The real hole is `POST /api/refresh`: anyone who can reach it can start a scrape. For anything public it needs auth and a rate limit, or it should move to a job runner.

**Why does the page hydrate state in an effect (an extra render)?**
URL and localStorage are only available in the browser, and reading them during render would cause a hydration mismatch. The cost is a skeleton until the first response arrives. A server-rendered first page with URL filters parsed on the server would remove it.

**What was the hardest part?**
Getting through DIBBS reliably: the consent interstitial, the WAF rejecting `fetch`, and ASP.NET postback paging that needs the hidden state echoed back for each page. After that, the part worth the time was deciding which filters mean something to a vendor.

**Why Next.js route handlers and not server components?**
The UI is highly interactive (debounced search, many filters, abortable requests), so a client page that calls a small JSON API is the straightforward fit. The API is also reusable by anything else, like a future alerting job.

**How do facet counts work, and why exclude the facet's own selection?**
Each row gets a bitmask of the filters it fails. The list is rows with mask 0. A facet counts rows that pass everything except its own filter, so choosing SDVOSB still shows what you would get from HUBZone. One pass over the data builds the list and every facet.

## Things not to do live

- Do not click **Refresh from DIBBS** unless the network is known good; it hits the live site and takes a while. The committed snapshot is the safe demo path.
- Do not claim tests, scheduled ingestion, or price data. They are on the roadmap, and saying so reads as good judgment.
- If asked about numbers, the snapshot is about 10.6k RFQs across 7 issue days; the API answers in 10 to 20 ms warm (single-machine curl, not a benchmark).
