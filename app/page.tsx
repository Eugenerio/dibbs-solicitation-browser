"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal, Sparkles, Star } from "lucide-react";
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
import { emptyInterests, interestCount, KEYS, readInterests, readJson, STARTER_PROFILES, writeJson, type Interests } from "@/lib/ui/storage";
import { useRfqs } from "@/lib/ui/use-rfqs";

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
    const has = interestCount(ints) > 0;
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
    else if (tab === "all" && hasInterests) sp.set("tab", "all");
    const qs = sp.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, [ready, filters, tab, hasInterests]);

  // What actually goes to the API: UI filters + interests + the tab's matchesOnly.
  const requestFilters = useMemo<RfqFilters>(
    () => ({ ...filters, matchesOnly: tab === "foryou", intFsc: [...interests.fsg, ...interests.fsc], intKw: interests.kw }),
    [filters, tab, interests],
  );
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
  const toggleSave = useCallback((r: RfqView) => {
    setSaved((prev) => (prev.some((s) => s.solNumber === r.solNumber) ? prev.filter((s) => s.solNumber !== r.solNumber) : [r, ...prev]));
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

  const sidebarProps = { filters, facets, onChange: patch, onClear: clearFilters };
  const showForYouOnboarding = tab === "foryou" && !hasInterests;

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
          <aside className="sticky top-[76px] hidden max-h-[calc(100vh-92px)] w-[280px] shrink-0 overflow-y-auto rounded-xl border bg-card p-4 md:block">
            <FilterSidebar {...sidebarProps} />
          </aside>
        )}

        <main className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Tabs value={tab} onValueChange={(v) => changeTab(v as Tab)}>
              <TabsList className="h-9">
                <TabsTrigger value="foryou" className="gap-1.5 px-3">
                  <Sparkles className="size-3.5" aria-hidden />
                  {tabLabel("For you", hasInterests ? counts.foryou : null)}
                </TabsTrigger>
                <TabsTrigger value="all" className="gap-1.5 px-3">
                  {tabLabel("All RFQs", counts.all ?? (tab === "all" ? list?.total ?? null : null))}
                </TabsTrigger>
                <TabsTrigger value="saved" className="gap-1.5 px-3">
                  <Star className="size-3.5" aria-hidden />
                  {tabLabel("Saved", saved.length)}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {tab !== "saved" && (
              <Button variant="outline" className="md:hidden" onClick={() => setFiltersOpen(true)}>
                <SlidersHorizontal aria-hidden /> Filters
                {activeCount > 0 && (
                  <Badge className="h-4 min-w-4 px-1 text-[0.7rem]">{activeCount}</Badge>
                )}
              </Button>
            )}

            {tab !== "saved" && !showForYouOnboarding && list && (
              <p className="ml-auto text-sm text-muted-foreground" aria-live="polite">
                <span className="font-medium text-foreground tabular-nums">{fmtInt(total)}</span> {total === 1 ? "RFQ" : "RFQs"}
              </p>
            )}
          </div>

          {tab !== "saved" && !showForYouOnboarding && <ActiveFilters filters={filters} onChange={patch} onClear={clearFilters} />}

          {showForYouOnboarding ? (
            <Onboarding onPick={(fsg) => changeInterests({ ...interests, fsg })} onCustomize={() => setInterestsOpen(true)} />
          ) : tab === "saved" ? (
            saved.length === 0 ? (
              <EmptyCard
                icon={<Star className="size-5" aria-hidden />}
                title="Nothing saved yet"
                body="Star an RFQ in the list or the detail view to keep it here, even after it drops off the daily feed."
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
                onOpen={setSelected}
                sort={filters.sort}
                onSortChange={onSortChange}
                hasInterests={hasInterests}
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
                savedIds={savedIds}
                onToggleSave={toggleSave}
                onOpen={setSelected}
                sort={filters.sort}
                onSortChange={onSortChange}
                hasInterests={hasInterests}
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

function EmptyCard({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed bg-card px-6 py-14 text-center">
      <div className="mb-3 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}

function Onboarding({ onPick, onCustomize }: { onPick(fsg: string[]): void; onCustomize(): void }) {
  return (
    <EmptyCard
      icon={<Sparkles className="size-5" aria-hidden />}
      title="Tell us what you can supply"
      body="We rank every RFQ by fit with your product categories and keywords, so the ones worth quoting rise to the top. Pick a starting point or build your own."
    >
      {STARTER_PROFILES.map((p) => (
        <Button key={p.id} variant="outline" onClick={() => onPick(p.fsg)}>
          {p.label}
        </Button>
      ))}
      <Button onClick={onCustomize}>Customize…</Button>
    </EmptyCard>
  );
}
