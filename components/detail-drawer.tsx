"use client"

import * as React from "react"
import { Check, Copy, ExternalLink, FileText, Info, Star, Zap } from "lucide-react"

import { ClosesBadge, FastAwardBadge, MatchChips, SetAsideBadge, formatLongDate } from "@/components/badges"
import { useCopy } from "@/components/results-table"
import { Button, buttonVariants } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { RfqView } from "@/lib/rfq/types"

function daysLeftText(d: number) {
  if (d < 0) return `Closed ${-d} day${d === -1 ? "" : "s"} ago`
  if (d === 0) return "Closes today"
  if (d === 1) return "1 day left"
  return `${d} days left`
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[7.5rem_1fr] gap-3 py-2 text-sm", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  )
}

const linkBtn = (variant: "default" | "outline", full = true) =>
  cn(buttonVariants({ variant, size: "lg" }), full && "w-full")

export function DetailDrawer({
  rfq,
  onClose,
  saved,
  onToggleSave,
}: {
  rfq: RfqView | null
  onClose: () => void
  saved: boolean
  onToggleSave: (r: RfqView) => void
}) {
  // Keep the last RFQ rendered while the sheet animates out.
  const [last, setLast] = React.useState<RfqView | null>(rfq)
  if (rfq && rfq !== last) setLast(rfq)
  const r = rfq ?? last
  const { copied, copy } = useCopy()
  const primaryRef = React.useRef<HTMLAnchorElement>(null)

  return (
    <Sheet open={rfq != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        initialFocus={primaryRef}
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-[30rem]"
      >
        {r && (
          <TooltipProvider delay={250}>
            <SheetHeader className="gap-1 border-b pr-12">
              <SheetTitle className="text-lg leading-snug font-semibold">{r.nomenclature}</SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {r.solNumber} · NSN {r.nsnDisplay}
              </SheetDescription>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <ClosesBadge daysLeft={r.daysLeft} date={r.returnByDate} />
                <SetAsideBadge rfq={r} />
                {r.fastAward && <FastAwardBadge />}
              </div>
              {r.score != null && (
                <div className="mt-1">
                  <MatchChips reasons={r.matchReasons} />
                </div>
              )}
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4">
              <dl className="divide-y">
                <Field label="NSN">
                  <span className="font-mono">{r.nsnDisplay}</span>
                </Field>
                <Field label="Federal supply group">
                  {r.fsg ? `${r.fsg} · ${r.fsgName ?? "Unknown"}` : (r.fsgName ?? "-")}
                </Field>
                <Field label="Federal supply class">{r.fsc ?? "-"}</Field>
                <Field label="Quantity">
                  <span className="tabular-nums">{r.quantity == null ? "-" : r.quantity.toLocaleString("en-US")}</span>
                </Field>
                <Field label="Purchase request">
                  <span className="font-mono">{r.prNumber || "-"}</span>
                </Field>
                <Field label="Issued">{formatLongDate(r.issuedDate)}</Field>
                <Field label="Return by">
                  <span className="font-medium">{formatLongDate(r.returnByDate)}</span>
                  <span className="text-muted-foreground"> · {daysLeftText(r.daysLeft)}</span>
                </Field>
                <Field label="Set-aside">{r.setAsideLabel}</Field>
                <Field label="Fast award">
                  {r.fastAward ? (
                    <span className="flex items-start gap-1.5">
                      <Zap className="mt-0.5 size-3.5 shrink-0 fill-orange-500 text-orange-500" />
                      <span>
                        Candidate. Micro-purchase quotes may be awarded before the return date, so quote early.
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No</span>
                  )}
                </Field>
                <Field label="Technical docs">
                  {r.hasTechDocs ? (
                    <span className="flex items-center gap-1.5">
                      <FileText className="size-3.5 text-muted-foreground" />
                      {r.techDocs || "Available"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{r.techDocs || "None"}</span>
                  )}
                </Field>
                <Field label="Status">{r.status}</Field>
              </dl>
            </div>

            <SheetFooter className="gap-2 border-t bg-muted/30">
              <a
                ref={primaryRef}
                href={r.packageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={linkBtn("default")}
              >
                <ExternalLink data-icon="inline-start" />
                Open on DIBBS (Package View)
              </a>
              <div className="grid grid-cols-2 gap-2">
                {r.rfqPdfUrl && (
                  <a href={r.rfqPdfUrl} target="_blank" rel="noopener noreferrer" className={linkBtn("outline")}>
                    <FileText data-icon="inline-start" />
                    Solicitation PDF
                  </a>
                )}
                {r.nsnUrl && (
                  <a href={r.nsnUrl} target="_blank" rel="noopener noreferrer" className={linkBtn("outline")}>
                    <ExternalLink data-icon="inline-start" />
                    NSN page
                  </a>
                )}
                {r.quoteUrl && (
                  <a
                    href={r.quoteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(linkBtn("outline"), "col-span-2")}
                  >
                    <ExternalLink data-icon="inline-start" />
                    Submit quote on DIBBS
                    <span className="text-xs font-normal text-muted-foreground">(login required)</span>
                  </a>
                )}
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => copy(r.solNumber, r.nsnDisplay)}
                >
                  {copied === r.solNumber ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                  {copied === r.solNumber ? "Copied" : "Copy NSN"}
                </Button>
                <Button
                  variant={saved ? "secondary" : "outline"}
                  size="lg"
                  aria-pressed={saved}
                  onClick={() => onToggleSave(r)}
                >
                  <Star
                    data-icon="inline-start"
                    className={cn(saved && "fill-amber-400 text-amber-500")}
                  />
                  {saved ? "Saved" : "Save"}
                </Button>
              </div>
              <Separator />
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3 shrink-0" />
                <span>
                  DIBBS shows a DoD consent banner on your first visit. Accept it once to reach the RFQ. Submitting a
                  quote requires a DIBBS login.
                </span>
              </p>
            </SheetFooter>
          </TooltipProvider>
        )}
      </SheetContent>
    </Sheet>
  )
}
