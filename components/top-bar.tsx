"use client";

import { useEffect, useState, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { LearnedProfileButton } from "@/components/learned-profile";
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
    <header className="z-40 border-b lg:sticky lg:top-0 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:flex-nowrap">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="min-w-0 leading-tight">
            <h1 className="truncate text-[0.95rem] font-semibold tracking-tight">Solicitation Browser</h1>
            <p className="truncate text-xs text-muted-foreground">DLA RFQ opportunities</p>
          </div>
        </div>

        <div className="order-last w-full lg:order-none lg:mx-auto lg:max-w-xl lg:flex-1">
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
            <span className="max-w-44 truncate">
              {refresh.running ? (
                (refresh.message ?? "Refreshing…")
              ) : (
                <>
                  <span className="sm:hidden">Refresh</span>
                  <span className="hidden sm:inline">Refresh from DIBBS</span>
                </>
              )}
            </span>
          </Button>
          <LearnedProfileButton />
          <Button variant="ghost" onClick={onOpenInterests}>
            <span className="sm:hidden">Interests</span>
            <span className="hidden sm:inline">Pin interests (optional)</span>
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
