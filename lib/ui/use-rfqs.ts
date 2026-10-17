"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toSearchParams } from "@/lib/rfq/params";
import { getAnchorParam } from "@/lib/ui/anchors";
import type { FacetsResponse, ListResponse, MetaResponse, RefreshStatus, RfqFilters } from "@/lib/rfq/types";

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

/** Debounced value; the very first active render passes through immediately (no 200ms lag on page load). */
function useDebounced<T>(value: T, ms: number, active: boolean): T {
  const [v, setV] = useState(value);
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!active) return;
    if (!seeded) {
      setSeeded(true);
      setV(value);
      return;
    }
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms, active, seeded]);
  return seeded ? v : value;
}

export interface UseRfqsOptions {
  enabled: boolean; // false until the page hydrated filters from URL/localStorage
  listEnabled: boolean; // false on the local-only "Saved" tab
}

export interface TabCounts {
  all: number | null;
  foryou: number | null;
}

/**
 * Fetches list + facets + meta (+ cheap tab counts). Aborts superseded requests, keeps the previous data on screen while
 * refetching, and debounces the free-text query. `filters` must already include the interests (intFsc/intKw) and matchesOnly.
 */
export function useRfqs(filters: RfqFilters, { enabled, listEnabled }: UseRfqsOptions) {
  const dq = useDebounced(filters.q, 200, enabled);
  const typing = enabled && dq !== filters.q;
  const eff = useMemo<RfqFilters>(() => ({ ...filters, q: dq }), [filters, dq]);

  const hasInterests = eff.intFsc.length + eff.intKw.length > 0;
  const baseKey = toSearchParams(eff).toString();
  // semantic anchors are re-read only when filters change, so opening a drawer does not reshuffle the list behind it
  const sem = useMemo(() => (enabled ? getAnchorParam() : ""), [enabled, baseKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const semQ = sem ? `&sem=${encodeURIComponent(sem)}` : "";
  const listKey = baseKey + semQ;
  const facetsKey = toSearchParams({ ...eff, page: 1, sort: "closing", pageSize: 50 }).toString() + semQ;
  const countKey = (matches: boolean) =>
    toSearchParams({ ...eff, page: 1, pageSize: 1, sort: "closing", matchesOnly: matches }).toString() + (matches ? semQ : "");
  const allKey = countKey(false);
  const foryouKey = hasInterests ? countKey(true) : null;

  const [nonce, setNonce] = useState(0);
  const [list, setList] = useState<ListResponse | null>(null);
  const [facets, setFacets] = useState<FacetsResponse | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [counts, setCounts] = useState<TabCounts>({ all: null, foryou: null });
  const [listFetching, setListFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !listEnabled) return;
    const ac = new AbortController();
    setListFetching(true);
    setError(null);
    getJson<ListResponse>(`/api/rfqs?${listKey}`, ac.signal)
      .then((d) => {
        setList(d);
        setListFetching(false);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Something went wrong");
        setListFetching(false);
      });
    return () => ac.abort();
  }, [enabled, listEnabled, listKey, nonce]);

  useEffect(() => {
    if (!enabled || !listEnabled) return;
    const ac = new AbortController();
    getJson<FacetsResponse>(`/api/facets?${facetsKey}`, ac.signal)
      .then(setFacets)
      .catch(() => {
        /* facets are decorative: keep the previous ones */
      });
    return () => ac.abort();
  }, [enabled, listEnabled, facetsKey, nonce]);

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    getJson<MetaResponse>("/api/meta", ac.signal)
      .then(setMeta)
      .catch(() => {});
    return () => ac.abort();
  }, [enabled, nonce]);

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    getJson<ListResponse>(`/api/rfqs?${allKey}`, ac.signal)
      .then((d) => setCounts((c) => ({ ...c, all: d.total })))
      .catch(() => {});
    if (foryouKey) {
      getJson<ListResponse>(`/api/rfqs?${foryouKey}`, ac.signal)
        .then((d) => setCounts((c) => ({ ...c, foryou: d.total })))
        .catch(() => {});
    } else {
      setCounts((c) => (c.foryou === null ? c : { ...c, foryou: null }));
    }
    return () => ac.abort();
  }, [enabled, allKey, foryouKey, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    list,
    facets,
    meta,
    counts,
    error,
    loading: enabled && listEnabled && !list && !error,
    refetching: (listFetching && !!list) || typing,
    retry: reload,
    reload,
  };
}

export interface RefreshState {
  running: boolean;
  message: string | null;
  error: string | null;
}

/** POST /api/refresh, poll GET every 1.5s until it finishes, then call onDone (page reloads list/facets/meta). */
export function useRefresh(onDone: () => void) {
  const [state, setState] = useState<RefreshState>({ running: false, message: null, error: null });
  const alive = useRef(true);
  const polling = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      for (;;) {
        const s = await getJson<RefreshStatus>("/api/refresh");
        if (!alive.current) return;
        if (!s.running) {
          setState({ running: false, message: null, error: s.error });
          if (!s.error) onDoneRef.current();
          return;
        }
        const { done, total, message } = s.progress;
        setState({ running: true, message: message ?? (total ? `Fetching ${done}/${total}` : "Fetching from DIBBS"), error: null });
        await new Promise((r) => setTimeout(r, 1500));
        if (!alive.current) return;
      }
    } catch (e) {
      if (alive.current) setState({ running: false, message: null, error: e instanceof Error ? e.message : "Refresh failed" });
    } finally {
      polling.current = false;
    }
  }, []);

  const start = useCallback(async () => {
    setState({ running: true, message: "Starting", error: null });
    try {
      const res = await fetch("/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ days: 2 }) }); // incremental: only the newest issue days (full backfill is a CLI job)
      if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
      void poll();
    } catch (e) {
      setState({ running: false, message: null, error: e instanceof Error ? e.message : "Refresh failed" });
    }
  }, [poll]);

  useEffect(() => {
    alive.current = true;
    // Pick up a refresh that was already running (e.g. page reloaded mid-refresh).
    getJson<RefreshStatus>("/api/refresh")
      .then((s) => {
        if (s.running) void poll();
      })
      .catch(() => {});
    return () => {
      alive.current = false;
    };
  }, [poll]);

  return { ...state, start };
}
