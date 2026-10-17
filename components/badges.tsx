"use client"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { RfqView, SetAsideKey } from "@/lib/rfq/types"

/** "2026-10-16" -> "Oct 16" (UTC-safe, no hydration/timezone drift). */
export function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

/** "2026-10-16" -> "Oct 16, 2026" */
export function formatLongDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

const SET_ASIDE: Record<SetAsideKey, { short: string; cls: string }> = {
  unrestricted: { short: "Unrestricted", cls: "text-muted-foreground" },
  small_business: {
    short: "Small Business",
    cls: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  },
  hubzone: {
    short: "HUBZone",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  sdvosb: {
    short: "SDVOSB",
    cls: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
  },
  wosb: {
    short: "WOSB",
    cls: "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-500/30 dark:bg-pink-500/10 dark:text-pink-300",
  },
  edwosb: {
    short: "EDWOSB",
    cls: "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-500/30 dark:bg-pink-500/10 dark:text-pink-300",
  },
  combined: {
    short: "Combined",
    cls: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  },
  other: { short: "Other", cls: "text-muted-foreground" },
}

export function SetAsideBadge({ rfq }: { rfq: RfqView }) {
  const meta = SET_ASIDE[rfq.setAside] ?? SET_ASIDE.other
  const label = rfq.setAside === "other" && rfq.setAsideLabel ? rfq.setAsideLabel : meta.short
  return (
    <Badge variant="outline" className={cn("max-w-40", meta.cls)} title={rfq.setAsideLabel}>
      <span className="truncate">{label}</span>
    </Badge>
  )
}

export function ClosesBadge({ daysLeft, date }: { daysLeft: number; date: string }) {
  const title = `Return by ${formatLongDate(date)}`
  if (daysLeft < 0) {
    return (
      <Badge variant="outline" className="text-muted-foreground" title={title}>
        Closed
      </Badge>
    )
  }
  if (daysLeft === 0) {
    return (
      <Badge variant="destructive" className="font-semibold" title={title}>
        Today
      </Badge>
    )
  }
  const text = `in ${daysLeft}d`
  if (daysLeft <= 2) {
    return (
      <Badge
        variant="outline"
        className="border-amber-300 bg-amber-100 font-semibold text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300"
        title={title}
      >
        {text}
      </Badge>
    )
  }
  if (daysLeft <= 7) {
    return (
      <Badge
        variant="outline"
        className="border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-300"
        title={title}
      >
        {text}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="font-normal text-muted-foreground" title={title}>
      {text}
    </Badge>
  )
}

export function FastAwardBadge() {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex cursor-help" tabIndex={0} />}>
        <Badge
          variant="outline"
          className="border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300"
        >
          Fast award
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        Micro-purchase: quotes may be awarded before the return date. Quote early.
      </TooltipContent>
    </Tooltip>
  )
}

export function MatchChips({ reasons }: { reasons?: string[] }) {
  if (!reasons || reasons.length === 0) return null
  const shown = reasons.slice(0, 3)
  const extra = reasons.length - shown.length
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((r) => (
        <Badge
          key={r}
          variant="secondary"
          className="h-4 bg-primary/10 px-1.5 text-[11px] font-normal text-primary"
        >
          {r}
        </Badge>
      ))}
      {extra > 0 && (
        <span className="text-[11px] text-muted-foreground" title={reasons.slice(3).join(", ")}>
          +{extra}
        </span>
      )}
    </div>
  )
}
