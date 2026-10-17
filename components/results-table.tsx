"use client"

import * as React from "react"
import { ExternalLink } from "lucide-react"

import { ClosesBadge, FastAwardBadge, MatchChips, SetAsideBadge, formatShortDate } from "@/components/badges"
import { Button, buttonVariants } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { RfqView, SortKey } from "@/lib/rfq/types"

const SORT_ITEMS: { value: SortKey; label: string }[] = [
  { value: "closing", label: "Closing soonest" },
  { value: "newest", label: "Newest" },
  { value: "qty", label: "Quantity (high to low)" },
  { value: "item", label: "Item A-Z" },
  { value: "match", label: "Best match" },
]

/** Copy-to-clipboard with a short-lived "copied" key (shared with the drawer). */
export function useCopy() {
  const [copied, setCopied] = React.useState<string | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  React.useEffect(() => () => clearTimeout(timer.current), [])
  const copy = React.useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for insecure contexts / denied permission.
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      ta.remove()
      if (!ok) return
    }
    setCopied(key)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(null), 1200)
  }, [])
  return { copied, copy }
}

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false
  return (
    el.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
    ["combobox", "textbox", "option", "menuitem", "listbox"].includes(el.getAttribute("role") ?? "")
  )
}

const qtyFmt = (n: number | null) => (n == null ? "-" : n.toLocaleString("en-US"))

function NsnButton({
  rfq,
  copied,
  onCopy,
  className,
}: {
  rfq: RfqView
  copied: boolean
  onCopy: (r: RfqView) => void
  className?: string
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      title="Click to copy NSN"
      className={cn("-ml-2 font-mono tabular-nums", copied && "text-emerald-600 dark:text-emerald-400", className)}
      onClick={(e) => {
        e.stopPropagation()
        onCopy(rfq)
      }}
    >
      {copied ? "Copied" : rfq.nsnDisplay}
    </Button>
  )
}

function TechDocsFlag() {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex text-muted-foreground" tabIndex={0} />}>
        <span className="rounded-md border px-1.5 py-0.5 text-xs leading-none font-medium" aria-label="Technical documents available">
          Docs
        </span>
      </TooltipTrigger>
      <TooltipContent>Technical documents attached (drawings / specs)</TooltipContent>
    </Tooltip>
  )
}

function RowActions({
  rfq,
  saved,
  onToggleSave,
}: {
  rfq: RfqView
  saved: boolean
  onToggleSave: (r: RfqView) => void
}) {
  return (
    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
      <Button
        variant={saved ? "secondary" : "ghost"}
        size="xs"
        aria-label={saved ? "Remove from saved" : "Save RFQ"}
        aria-pressed={saved}
        title={saved ? "Saved (s)" : "Save (s)"}
        onClick={(e) => {
          e.stopPropagation()
          onToggleSave(rfq)
        }}
      >
        {saved ? "Saved" : "Save"}
      </Button>
      <a
        href={rfq.packageUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${rfq.solNumber} on DIBBS`}
        title="Open on DIBBS (o)"
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink />
      </a>
    </div>
  )
}

function ItemCell({ rfq }: { rfq: RfqView }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="line-clamp-2 font-semibold text-foreground">{rfq.nomenclature}</span>
      {rfq.fsgName && <span className="line-clamp-1 text-xs text-muted-foreground">{rfq.fsgName}</span>}
      {rfq.score != null && <MatchChips reasons={rfq.matchReasons} />}
    </div>
  )
}

const ROW_FOCUS = "bg-muted outline-2 -outline-offset-2 outline-ring"

export function ResultsTable({
  items,
  loading,
  refetching,
  error,
  onRetry,
  savedIds,
  onToggleSave,
  onOpen,
  sort,
  onSortChange,
  hasInterests,
  onClearFilters,
}: {
  onClearFilters?: () => void
  items: RfqView[]
  loading: boolean
  refetching: boolean
  error: string | null
  onRetry: () => void
  savedIds: Set<string>
  onToggleSave: (r: RfqView) => void
  onOpen: (r: RfqView) => void
  sort: SortKey
  onSortChange: (s: SortKey) => void
  hasInterests: boolean
}) {
  const { copied, copy } = useCopy()
  const [focusedSol, setFocusedSol] = React.useState<string | null>(null)
  const onCopy = React.useCallback((r: RfqView) => copy(r.solNumber, r.nsnDisplay), [copy])

  // j/k/Enter/o/s keyboard navigation (skipped while typing or while a dialog/sheet/popup is open).
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || items.length === 0) return
      if (isTypingTarget(e.target)) return
      if (document.querySelector('[role="dialog"], [role="listbox"], [role="menu"]')) return
      const idx = focusedSol ? items.findIndex((r) => r.solNumber === focusedSol) : -1
      const cur = idx >= 0 ? items[idx] : null
      const k = e.key
      if (k === "j") {
        e.preventDefault()
        setFocusedSol(items[Math.min(idx + 1, items.length - 1)].solNumber)
      } else if (k === "k") {
        e.preventDefault()
        setFocusedSol(items[Math.max(idx - 1, 0)].solNumber)
      } else if (k === "Enter" && cur && e.target === document.body) {
        e.preventDefault()
        onOpen(cur)
      } else if (k === "o" && cur) {
        window.open(cur.packageUrl, "_blank", "noopener,noreferrer")
      } else if (k === "s" && cur) {
        onToggleSave(cur)
      } else if (k === "Escape" && cur) {
        setFocusedSol(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [items, focusedSol, onOpen, onToggleSave])

  // Keep the focused row in view.
  React.useEffect(() => {
    if (!focusedSol) return
    const els = document.querySelectorAll<HTMLElement>(`[data-sol="${CSS.escape(focusedSol)}"]`)
    for (const el of els) {
      if (el.offsetParent !== null) {
        el.scrollIntoView({ block: "nearest" })
        break
      }
    }
  }, [focusedSol])

  const toolbar = (
    <div className="flex items-center justify-between gap-3 pb-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sort by</span>
        <Select
          items={SORT_ITEMS}
          value={sort}
          onValueChange={(v) => v && onSortChange(v as SortKey)}
        >
          <SelectTrigger size="sm" className="min-w-44" aria-label="Sort results">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start">
            {SORT_ITEMS.map((s) => (
              <SelectItem key={s.value} value={s.value} disabled={s.value === "match" && !hasInterests}>
                {s.label}
                {s.value === "match" && !hasInterests && (
                  <span className="text-xs text-muted-foreground">(set interests)</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="hidden items-center gap-3 text-xs text-muted-foreground lg:flex">
        <span className="flex items-center gap-1"><Kbd>j</Kbd><Kbd>k</Kbd> move</span>
        <span className="flex items-center gap-1"><Kbd>Enter</Kbd> details</span>
        <span className="flex items-center gap-1"><Kbd>o</Kbd> DIBBS</span>
        <span className="flex items-center gap-1"><Kbd>s</Kbd> save</span>
      </div>
    </div>
  )

  let body: React.ReactNode
  if (error) {
    body = (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
        <div>
          <p className="font-medium">Couldn&apos;t load RFQs</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    )
  } else if (loading) {
    body = (
      <div className="rounded-lg border" aria-busy="true" aria-label="Loading RFQs">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-3 py-3 last:border-0">
            <Skeleton className="h-4 w-28" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="hidden h-4 w-28 xl:block" />
            <Skeleton className="hidden h-5 w-20 rounded-full xl:block" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    )
  } else if (items.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
        <p className="font-medium">No RFQs match these filters</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Try removing a filter, widening the closing window, or including closed RFQs.
        </p>
        {onClearFilters && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onClearFilters}>
            Clear all filters
          </Button>
        )}
      </div>
    )
  } else {
    body = (
      <>
        {/* md+: real table */}
        <div
          className={cn(
            "hidden rounded-lg border xl:block [&_[data-slot=table-container]]:overflow-visible",
          )}
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {[
                  ["NSN", ""],
                  ["Item", ""],
                  ["Solicitation #", "hidden min-[1400px]:table-cell"],
                  ["Qty", "text-right"],
                  ["Set-aside", ""],
                  ["Flags", ""],
                  ["Issued", "hidden lg:table-cell"],
                  ["Closes", ""],
                  ["", "w-[100px]"],
                ].map(([label, cls], i) => (
                  <TableHead
                    key={i}
                    className={cn(
                      "sticky top-[57px] z-10 h-9 bg-muted text-xs font-medium tracking-wide text-muted-foreground uppercase shadow-[inset_0_-1px_0_var(--color-border)] first:rounded-tl-lg last:rounded-tr-lg",
                      cls
                    )}
                  >
                    {label || <span className="sr-only">Actions</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow
                  key={r.solNumber}
                  data-sol={r.solNumber}
                  onClick={() => {
                    setFocusedSol(r.solNumber)
                    onOpen(r)
                  }}
                  className={cn("scroll-mt-28 cursor-pointer", focusedSol === r.solNumber && ROW_FOCUS)}
                >
                  <TableCell className="py-2 pl-3">
                    <NsnButton rfq={r} copied={copied === r.solNumber} onCopy={onCopy} />
                  </TableCell>
                  <TableCell className="min-w-52 max-w-96 py-2 whitespace-normal">
                    <ItemCell rfq={r} />
                  </TableCell>
                  <TableCell className="hidden py-2 font-mono text-xs text-muted-foreground min-[1400px]:table-cell">
                    {r.solNumber}
                  </TableCell>
                  <TableCell className="py-2 text-right tabular-nums">{qtyFmt(r.quantity)}</TableCell>
                  <TableCell className="py-2">
                    <SetAsideBadge rfq={r} />
                  </TableCell>
                  <TableCell className="py-2">
                    <div className="flex items-center gap-1.5">
                      {r.fastAward && <FastAwardBadge />}
                      {r.hasTechDocs && <TechDocsFlag />}
                    </div>
                  </TableCell>
                  <TableCell className="hidden py-2 text-muted-foreground tabular-nums lg:table-cell">
                    {formatShortDate(r.issuedDate)}
                  </TableCell>
                  <TableCell className="py-2">
                    <ClosesBadge daysLeft={r.daysLeft} date={r.returnByDate} />
                  </TableCell>
                  <TableCell className="py-2 pr-2">
                    <RowActions rfq={r} saved={savedIds.has(r.solNumber)} onToggleSave={onToggleSave} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* <md: stacked cards */}
        <ul className="flex flex-col gap-2 xl:hidden">
          {items.map((r) => (
            <li
              key={r.solNumber}
              data-sol={r.solNumber}
              onClick={() => {
                setFocusedSol(r.solNumber)
                onOpen(r)
              }}
              className={cn(
                "scroll-mt-28 cursor-pointer rounded-lg border bg-card p-3 text-sm transition-colors hover:bg-muted/50",
                focusedSol === r.solNumber && ROW_FOCUS
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <ItemCell rfq={r} />
                <ClosesBadge daysLeft={r.daysLeft} date={r.returnByDate} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <NsnButton rfq={r} copied={copied === r.solNumber} onCopy={onCopy} className="text-foreground" />
                <span className="font-mono">{r.solNumber}</span>
                <span className="tabular-nums">Qty {qtyFmt(r.quantity)}</span>
                <span>Issued {formatShortDate(r.issuedDate)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <SetAsideBadge rfq={r} />
                  {r.fastAward && <FastAwardBadge />}
                  {r.hasTechDocs && <TechDocsFlag />}
                </div>
                <RowActions rfq={r} saved={savedIds.has(r.solNumber)} onToggleSave={onToggleSave} />
              </div>
            </li>
          ))}
        </ul>
      </>
    )
  }

  return (
    <TooltipProvider delay={250}>
      <section aria-label="RFQ results">
        {toolbar}
        <div
          className={cn(
            "transition-opacity duration-150",
            refetching && "opacity-60"
          )}
          aria-busy={refetching || loading}
        >
          {body}
        </div>
      </section>
    </TooltipProvider>
  )
}
