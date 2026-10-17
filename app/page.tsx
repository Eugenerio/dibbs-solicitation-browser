"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActiveFilters } from "@/components/active-filters";
import { DetailDrawer } from "@/components/detail-drawer";
import { FilterSidebar } from "@/components/filter-sidebar";
import { InterestsPanel } from "@/components/interests-panel";
import { PaginationBar } from "@/components/pagination-bar";
import { ResultsTable } from "@/components/results-table";
import { TopBar } from "@/components/top-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { defaultFilters, parseFilters, toSearchParams } from "@/lib/rfq/params";
import type { RfqFilters, RfqView, SortKey } from "@/lib/rfq/types";
import { activeFilterCount, daysUntil, fmtInt, todayIsoUtc } from "@/lib/ui/format";
import { emptyInterests, interestCount, KEYS, readInterests, readJson, writeJson, type Interests } from "@/lib/ui/storage";
import { useRfqs } from "@/lib/ui/use-rfqs";
import {
  getProfile,
  getTop,
  LEARNED_MIN_STRENGTH,
  recordFilterFsg,
  recordOpen,
  recordSave,
  recordSearch,
  recordUnsave,
  useLearnedProfile,
} from "@/lib/ui/learned-interests";
import { addAnchor, removeAnchor } from "@/lib/ui/anchors";

type Tab = "foryou" | "all" | "saved";

function sortSaved(items: RfqView[], sort: SortKey): RfqView[] {
  const out = items.slice();
  switch (sort) {
    case "newest":
      return out.sort((a, b) => (a.issuedDate < b.issuedDate ? 1 : a.issuedDate > b.issuedDate ? -1 : a.daysLeft - b.daysLeft));
    case "qty":
      return out.sort((a, b) => (b.quantity ?? -1) - (a.quantity ?? -1));
    case "item":
      return out.sort((a, b) => a.nomenclature.localeCompare(b.nomenclature));
    default:
      return out.sort((a, b) => a.daysLeft - b.daysLeft);
  }
}

export default function Page() {
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<RfqFilters>(defaultFilters);
  const [tab, setTab] = useState<Tab>("all");
  const [interests, setInterests] = useState<Interests>(emptyInterests);
  const [saved, setSaved] = useState<RfqView[]>([]);
  const [selected, setSelected] = useState<RfqView | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [interestsOpen, setInterestsOpen] = useState(false);
  const [clientToday, setClientToday] = useState<string | null>(null); // never read the clock during prerender
  const searchRef = useRef<HTMLInputElement>(null);

  // Hydrate from URL + localStorage after mount (keeps SSR markup identical, no hydration mismatch).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const parsed = parseFilters(sp);
    const ints = readInterests();
    const has = interestCount(ints) > 0 || getTop(getProfile()).strength >= LEARNED_MIN_STRENGTH;
    const tabParam = sp.get("tab");
    let t: Tab = "all";
    let sort = parsed.sort;
    if (tabParam === "saved") t = "saved";
    else if (tabParam === "all") t = "all";
    else if (parsed.matchesOnly) t = "foryou";
    else if (has && sp.size === 0) {
      t = "foryou"; // returning vendor with a profile: land on their ranked feed
      sort = "match";
    }
    setFilters({ ...parsed, sort, matchesOnly: false, intFsc: [], intKw: [] });
    setTab(t);
    setInterests(ints);
    setSaved(readJson<RfqView[]>(KEYS.saved, []).filter((r) => r && typeof r.solNumber === "string"));
    setClientToday(todayIsoUtc());
    setReady(true);
  }, []);

  const hasInterests = interestCount(interests) > 0;

  // Learned (implicit) interests: top-K of the behavior vector, applied only once we've seen enough activity.
  // Keys are sorted strings so re-ordering inside the top-K doesn't refetch; only membership changes do.
  const learnedProfile = useLearnedProfile();
  const learned = useMemo(() => getTop(learnedProfile), [learnedProfile]);
  const learnedActive = learned.strength >= LEARNED_MIN_STRENGTH;
  const learnedIfscKey = learnedActive ? [...learned.ifsc].sort().join(",") : "";
  const learnedIkwKey = learnedActive ? [...learned.ikw].sort().join(",") : "";
  const hasProfile = hasInterests || learnedActive;

  // Search counts as interest once the user stops typing (once per distinct query).
  const lastSearchRef = useRef("");
  useEffect(() => {
    if (!ready) return;
    const q = filters.q.trim().toLowerCase();
    if (q.length < 3 || q === lastSearchRef.current) return;
    const t = setTimeout(() => {
      lastSearchRef.current = q;
      recordSearch(q);
    }, 900);
    return () => clearTimeout(t);
  }, [ready, filters.q]);

  // Persist.
  useEffect(() => {
    if (ready) writeJson(KEYS.interests, interests);
  }, [ready, interests]);
  useEffect(() => {
    if (ready) writeJson(KEYS.saved, saved);
  }, [ready, saved]);

  // Shareable URL.
  useEffect(() => {
    if (!ready) return;
    const sp = toSearchParams({ ...filters, matchesOnly: tab === "foryou" });
    if (tab === "saved") sp.set("tab", "saved");
    else if (tab === "all" && hasProfile) sp.set("tab", "all");
    const qs = sp.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, [ready, filters, tab, hasProfile]);

  // What actually goes to the API: UI filters + (pinned ∪ learned) interests + the tab's matchesOnly.
  const requestFilters = useMemo<RfqFilters>(() => {
    const split = (k: string) => (k ? k.split(",") : []);
    const intFsc = [...new Set([...interests.fsg, ...interests.fsc, ...split(learnedIfscKey)])];
    const intKw = [...new Set([...interests.kw, ...split(learnedIkwKey)])];
    return { ...filters, matchesOnly: tab === "foryou" && intFsc.length + intKw.length > 0, intFsc, intKw };
  }, [filters, tab, interests, learnedIfscKey, learnedIkwKey]);
  const { list, facets, meta, counts, error, loading, refetching, retry, reload } = useRfqs(requestFilters, {
    enabled: ready,
    listEnabled: tab !== "saved",
  });

  const patch = useCallback((p: Partial<RfqFilters>) => setFilters((f) => ({ ...f, ...p, page: p.page ?? 1 })), []);
  const clearFilters = useCallback(() => setFilters((f) => ({ ...defaultFilters(), sort: f.sort, pageSize: f.pageSize })), []);

  const changeTab = useCallback((next: Tab) => {
    setTab(next);
    setFilters((f) => ({
      ...f,
      page: 1,
      sort: next === "foryou" ? "match" : f.sort === "match" ? "closing" : f.sort,
    }));
  }, []);

  const changeInterests = useCallback(
    (next: Interests) => {
      const had = interestCount(interests) > 0;
      const has = interestCount(next) > 0;
      setInterests(next);
      if (!had && has) {
        setTab("foryou");
        setFilters((f) => ({ ...f, sort: "match", page: 1 }));
      } else if (had && !has) {
        if (tab === "foryou") setTab("all");
        setFilters((f) => ({ ...f, sort: f.sort === "match" ? "closing" : f.sort, page: 1 }));
      } else {
        setFilters((f) => (f.page === 1 ? f : { ...f, page: 1 }));
      }
    },
    [interests, tab],
  );

  const savedIds = useMemo(() => new Set(saved.map((s) => s.solNumber)), [saved]);
  const toggleSave = useCallback(
    (r: RfqView) => {
      if (saved.some((s) => s.solNumber === r.solNumber)) {
        recordUnsave(r);
        removeAnchor(r.solNumber);
      } else {
        recordSave(r);
        addAnchor(r.solNumber, 3);
      }
      setSaved((prev) => (prev.some((s) => s.solNumber === r.solNumber) ? prev.filter((s) => s.solNumber !== r.solNumber) : [r, ...prev]));
    },
    [saved],
  );
  const openRow = useCallback((r: RfqView) => {
    setSelected(r);
    recordOpen(r);
    addAnchor(r.solNumber, 1);
  }, []);

  const todayIso = meta?.today ?? clientToday;
  const savedItems = useMemo(() => {
    const tokens = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = saved
      .map((r) => (todayIso ? { ...r, daysLeft: daysUntil(r.returnByDate, todayIso) } : r))
      .filter((r) => {
        if (!tokens.length) return true;
        const hay = `${r.solNumber} ${r.nsn} ${r.nsnDisplay} ${r.nomenclature} ${r.prNumber}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    return sortSaved(rows, filters.sort);
  }, [saved, filters.q, filters.sort, todayIso]);

  const onPage = useCallback((p: number) => {
    setFilters((f) => ({ ...f, page: p }));
    window.scrollTo({ top: 0 });
  }, []);

  const onSortChange = useCallback((s: SortKey) => patch({ sort: s }), [patch]);
  const activeCount = activeFilterCount(filters);
  const total = list?.total ?? 0;

  const tabLabel = (name: string, n: number | null) => (
    <>
      {name}
      {n != null && <span className="text-xs text-muted-foreground tabular-nums">{fmtInt(n)}</span>}
    </>
  );

  // Newly checked supply groups are a strong interest signal.
  const onSidebarChange = useCallback(
    (p: Partial<RfqFilters>) => {
      for (const code of p.fsg ?? []) {
        if (filters.fsg.includes(code)) continue;
        const label = facets?.fsg.find((o) => o.key === code)?.label;
        recordFilterFsg(code, label?.replace(/^\d{2}\s*[·-]?\s*/, ""));
      }
      patch(p);
    },
    [filters.fsg, facets, patch],
  );
  const sidebarProps = { filters, facets, onChange: onSidebarChange, onClear: clearFilters };
  const showForYouHint = tab === "foryou" && !hasProfile;

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-muted/40">
      <TopBar
        q={filters.q}
        onQChange={(q) => patch({ q })}
        meta={meta}
        interestCount={interestCount(interests)}
        onOpenInterests={() => setInterestsOpen(true)}
        onRefreshed={reload}
        searchRef={searchRef}
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 items-start gap-6 px-4 py-4">
        {tab !== "saved" && (
          <aside className="sticky top-[76px] hidden max-h-[calc(100vh-92px)] w-[280px] shrink-0 overflow-y-auto rounded-xl border bg-card p-4 xl:block">
            <FilterSidebar {...sidebarProps} />
          </aside>
        )}

        <main className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Tabs value={tab} onValueChange={(v) => changeTab(v as Tab)}>
              <TabsList className="h-9 max-w-full">
                <TabsTrigger value="foryou" className="gap-1 px-2 sm:gap-1.5 sm:px-3">
                  {tabLabel("For you", hasProfile ? counts.foryou : null)}
                </TabsTrigger>
                <TabsTrigger value="all" className="gap-1 px-2 sm:gap-1.5 sm:px-3">
                  {tabLabel("All RFQs", counts.all ?? (tab === "all" ? list?.total ?? null : null))}
                </TabsTrigger>
                <TabsTrigger value="saved" className="gap-1 px-2 sm:gap-1.5 sm:px-3">
                  {tabLabel("Saved", saved.length)}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {tab !== "saved" && (
              <Button variant="outline" className="xl:hidden" onClick={() => setFiltersOpen(true)}>
                Filters
                {activeCount > 0 && (
                  <Badge className="h-4 min-w-4 px-1 text-[0.7rem]">{activeCount}</Badge>
                )}
              </Button>
            )}

            {tab !== "saved" && list && (
              <p className="ml-auto text-sm text-muted-foreground" aria-live="polite">
                <span className="font-medium text-foreground tabular-nums">{fmtInt(total)}</span> {total === 1 ? "RFQ" : "RFQs"}
              </p>
            )}
          </div>

          {showForYouHint && (
            <p className="text-sm text-muted-foreground">Search, open or save a few RFQs and results will start ranking by fit.</p>
          )}

          {tab !== "saved" && <ActiveFilters filters={filters} onChange={patch} onClear={clearFilters} />}

          {tab === "saved" ? (
            saved.length === 0 ? (
              <EmptyCard
                title="Nothing saved yet"
                body="Save an RFQ in the list or the detail view to keep it here, even after it drops off the daily feed."
              />
            ) : (
              <ResultsTable
                items={savedItems}
                loading={false}
                refetching={false}
                error={null}
                onRetry={() => {}}
                savedIds={savedIds}
                onToggleSave={toggleSave}
                onOpen={openRow}
                sort={filters.sort}
                onSortChange={onSortChange}
                hasInterests={hasProfile}
              />
            )
          ) : (
            <>
              <ResultsTable
                items={list?.items ?? []}
                loading={loading || !ready}
                refetching={refetching}
                error={error}
                onRetry={retry}
                onClearFilters={activeCount > 0 ? clearFilters : undefined}
                savedIds={savedIds}
                onToggleSave={toggleSave}
                onOpen={openRow}
                sort={filters.sort}
                onSortChange={onSortChange}
                hasInterests={hasProfile}
              />
              {list && list.total > 0 && (
                <PaginationBar page={list.page} pages={list.pages} total={list.total} pageSize={list.pageSize} onPage={onPage} />
              )}
            </>
          )}
        </main>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" className="w-[88vw] gap-0 p-0 sm:max-w-sm">
          <SheetHeader className="border-b p-4 pr-12">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Narrow down {list ? `${fmtInt(total)} RFQs` : "the feed"}.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            <FilterSidebar {...sidebarProps} hideHeading />
          </div>
          <SheetFooter className="border-t p-3">
            <Button onClick={() => setFiltersOpen(false)}>Show {list ? fmtInt(total) : ""} RFQs</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <InterestsPanel open={interestsOpen} onOpenChange={setInterestsOpen} interests={interests} onChange={changeInterests} />

      <DetailDrawer rfq={selected} onClose={() => setSelected(null)} saved={selected ? savedIds.has(selected.solNumber) : false} onToggleSave={toggleSave} />
    </div>
  );
}

function EmptyCard({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed bg-card px-6 py-14 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}
