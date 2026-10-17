"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { getTop, LEARNED_MIN_STRENGTH, reset, useLearnedProfile } from "@/lib/ui/learned-interests";

/** Read-only view of what we inferred from activity, plus a reset. No setup, nothing to fill in. */
export function LearnedProfileButton() {
  const profile = useLearnedProfile();
  const top = useMemo(() => getTop(profile), [profile]);
  const enough = top.strength >= LEARNED_MIN_STRENGTH;
  const maxKw = top.topKeywords[0]?.weight ?? 1;

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>Your profile</PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>Learned from your activity</PopoverTitle>
          <PopoverDescription className="text-xs">No setup needed: we learn from what you search, open and save.</PopoverDescription>
        </PopoverHeader>

        {!enough ? (
          <p className="text-sm text-muted-foreground">Not enough activity yet - search, open or save a few RFQs.</p>
        ) : (
          <>
            {top.topCategories.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Categories</h3>
                <div className="flex flex-wrap gap-1.5">
                  {top.topCategories.map((c) => (
                    <Badge key={c.code} variant="secondary" className="max-w-full">
                      <span className="truncate">{c.label}</span>
                    </Badge>
                  ))}
                </div>
              </section>
            )}
            {top.topKeywords.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Keywords</h3>
                <ul className="space-y-1">
                  {top.topKeywords.map((k) => (
                    <li key={k.word} className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-sm">
                      <span className="truncate">{k.word}</span>
                      <div className="h-1.5 rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(6, (k.weight / maxKw) * 100)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={reset} disabled={top.strength === 0}>
            Reset
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
