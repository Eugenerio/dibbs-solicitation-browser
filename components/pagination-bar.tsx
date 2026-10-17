"use client"

import { Button } from "@/components/ui/button"

function pageList(page: number, pages: number): (number | "gap-l" | "gap-r")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const out: (number | "gap-l" | "gap-r")[] = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(pages - 1, page + 1)
  if (start > 2) out.push("gap-l")
  for (let p = start; p <= end; p++) out.push(p)
  if (end < pages - 1) out.push("gap-r")
  out.push(pages)
  return out
}

export function PaginationBar({
  page,
  pages,
  total,
  pageSize,
  onPage,
}: {
  page: number
  pages: number
  total: number
  pageSize: number
  onPage: (p: number) => void
}) {
  if (total <= 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const fmt = (n: number) => n.toLocaleString("en-US")

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 px-1 py-3 text-sm"
    >
      <p className="text-muted-foreground tabular-nums">
        Showing <span className="font-medium text-foreground">{fmt(from)}-{fmt(to)}</span> of{" "}
        <span className="font-medium text-foreground">{fmt(total)}</span>
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            Previous
          </Button>
          <div className="hidden items-center gap-1 sm:flex">
            {pageList(page, pages).map((p) =>
              typeof p === "number" ? (
                <Button
                  key={p}
                  variant={p === page ? "default" : "ghost"}
                  size="sm"
                  className="min-w-7 tabular-nums"
                  aria-current={p === page ? "page" : undefined}
                  aria-label={`Page ${p}`}
                  onClick={() => p !== page && onPage(p)}
                >
                  {p}
                </Button>
              ) : (
                <span key={p} className="px-1 text-muted-foreground" aria-hidden>
                  …
                </span>
              )
            )}
          </div>
          <span className="px-2 text-muted-foreground tabular-nums sm:hidden">
            {page} / {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            Next
          </Button>
        </div>
      )}
    </nav>
  )
}
