"use client";

import { useEffect, useState, type RefObject } from "react";
import { Crosshair, Loader2, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { fmtInt, timeAgo } from "@/lib/ui/format";
import { useRefresh } from "@/lib/ui/use-rfqs";
import type { MetaResponse } from "@/lib/rfq/types";

interface TopBarProps {
  q: string;
  onQChange(q: string): void;
  meta: MetaResponse | null;
  interestCount: number;
  onOpenInterests(): void;
  onRefreshed(): void;
  searchRef: RefObject<HTMLInputElement | null>;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

export function TopBar({ q, onQChange, meta, interestCount, onOpenInterests, onRefreshed, searchRef }: TopBarProps) {
  const refresh = useRefresh(onRefreshed);
  const [, setTick] = useState(0);

  // "updated N min ago" stays honest without a reload.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // "/" focuses search from anywhere (unless already typing somewhere or a modifier is held).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchRef]);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 md:flex-nowrap">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Crosshair className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 leading-tight">
            <h1 className="truncate text-[0.95rem] font-semibold tracking-tight">Solicitation Browser</h1>
            <p className="truncate text-xs text-muted-foreground">DLA RFQ opportunities</p>
          </div>
        </div>

        <div className="order-last w-full md:order-none md:mx-auto md:max-w-xl md:flex-1">
          <InputGroup className="h-9">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchRef}
              type="search"
              value={q}
              onChange={(e) => onQChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (q) onQChange("");
                  else e.currentTarget.blur();
                }
              }}
              placeholder="Search NSN, solicitation #, item, PR…"
              aria-label="Search RFQs"
              autoComplete="off"
              spellCheck={false}
              className="[&::-webkit-search-cancel-button]:hidden"
            />
            <InputGroupAddon align="inline-end">
              {q ? (
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => onQChange("")}>
                  <X />
                </InputGroupButton>
              ) : (
                <Kbd className="hidden sm:inline-flex">/</Kbd>
              )}
            </InputGroupAddon>
          </InputGroup>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div className="hidden text-right text-xs leading-tight text-muted-foreground xl:block" aria-live="polite">
            {refresh.error ? (
              <span className="text-destructive">Refresh failed: {refresh.error}</span>
            ) : meta ? (
              <>
                <span className="font-medium text-foreground">{fmtInt(meta.open)}</span> open RFQs
                <br />
                updated {timeAgo(meta.refreshedAt)}
              </>
            ) : (
              <span>Loading…</span>
            )}
          </div>
          <Button variant="outline" onClick={() => void refresh.start()} disabled={refresh.running} title="Re-scrape the latest RFQs from DIBBS">
            {refresh.running ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            <span className="hidden max-w-44 truncate sm:inline">{refresh.running ? (refresh.message ?? "Refreshing") : "Refresh from DIBBS"}</span>
          </Button>
          <Button onClick={onOpenInterests}>
            <Sparkles aria-hidden />
            <span className="hidden sm:inline">My interests</span>
            {interestCount > 0 && (
              <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[0.7rem]">
                {interestCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
