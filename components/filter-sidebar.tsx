"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { activeFilterCount, fmtInt, shortDate, splitFsgLabel } from "@/lib/ui/format";
import type { FacetOption, FacetsResponse, RfqFilters, SetAsideKey } from "@/lib/rfq/types";

interface FilterSidebarProps {
  filters: RfqFilters;
  facets: FacetsResponse | null;
  onChange(patch: Partial<RfqFilters>): void;
  onClear(): void;
  /** Hide the "Filters" heading (the mobile Sheet already has a title). */
  hideHeading?: boolean;
}

const CHIP =
  "gap-1.5 px-2.5 data-pressed:border-primary data-pressed:bg-primary data-pressed:text-primary-foreground data-pressed:hover:bg-primary/90";
const CHIP_COUNT = "text-[0.7rem] text-muted-foreground tabular-nums group-data-pressed/toggle:text-primary-foreground/75";

const CLOSING: { key: string; label: string }[] = [
  { key: "0", label: "Today" },
  { key: "3", label: "≤ 3 days" },
  { key: "7", label: "≤ 7 days" },
  { key: "14", label: "≤ 14 days" },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const Count = ({ n }: { n: number | undefined }) =>
  n == null ? null : <span className="ml-auto pl-2 text-xs text-muted-foreground tabular-nums">{fmtInt(n)}</span>;

/** Number input that commits 250ms after the last keystroke and re-syncs when the filter is changed from elsewhere. */
function QtyInput({ value, placeholder, label, onCommit }: { value: number | null; placeholder: string; label: string; onCommit(v: number | null): void }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setText((t) => ((t === "" ? null : Number(t)) === value ? t : value == null ? "" : String(value)));
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={0}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const n = v === "" ? null : Math.max(0, Math.floor(Number(v)));
          onCommit(n != null && Number.isFinite(n) ? n : null);
        }, 250);
      }}
    />
  );
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function FilterSidebar({ filters, facets, onChange, onClear, hideHeading }: FilterSidebarProps) {
  const [catQuery, setCatQuery] = useState("");
  const activeCount = activeFilterCount(filters);

  const fsgOptions = useMemo(() => {
    const all: FacetOption[] = facets?.fsg ?? [];
    const q = catQuery.trim().toLowerCase();
    return q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  }, [facets, catQuery]);

  const asideOptions = facets?.setAside ?? [];
  const issuedOptions = (facets?.issued ?? []).slice(0, 8);
  const sameDay = filters.issuedFrom && filters.issuedFrom === filters.issuedTo ? filters.issuedFrom : null;
  const closesValue = filters.closesWithin != null ? [String(filters.closesWithin)] : [];

  return (
    <div className="space-y-5">
      <div className={hideHeading ? "flex items-center justify-end" : "flex items-center justify-between"}>
        {!hideHeading && <h2 className="text-sm font-semibold">Filters</h2>}
        <Button variant="ghost" size="sm" onClick={onClear} disabled={activeCount === 0}>
          Clear all{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>

      <Section title="Closing soon" hint="Quote deadline (return-by date)">
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={1}
          className="flex-wrap"
          value={closesValue}
          onValueChange={(v) => onChange({ closesWithin: v[0] != null ? Number(v[0]) : null })}
          aria-label="Closing soon"
        >
          {CLOSING.map((c) => {
            const n = facets?.closing.find((o) => o.key === c.key)?.count;
            return (
              <ToggleGroupItem key={c.key} value={c.key} className={CHIP}>
                {c.label}
                {n != null && <span className={CHIP_COUNT}>{fmtInt(n)}</span>}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </Section>

      <Separator />

      <Section title="Set-aside" hint="Who is allowed to bid">
        {!facets ? (
          <SkeletonRows n={4} />
        ) : asideOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">None in the current view.</p>
        ) : (
          <div className="space-y-2">
            {asideOptions.map((o) => (
              <Label key={o.key} className="cursor-pointer font-normal">
                <Checkbox
                  checked={filters.setAside.includes(o.key as SetAsideKey)}
                  onCheckedChange={() => onChange({ setAside: toggle(filters.setAside, o.key as SetAsideKey) })}
                />
                <span className="truncate">{o.label}</span>
                <Count n={o.count} />
              </Label>
            ))}
          </div>
        )}
      </Section>

      <Separator />

      <Section title="Category" hint="Federal supply group (first 2 digits of the NSN)">
        <Input
          value={catQuery}
          onChange={(e) => setCatQuery(e.target.value)}
          placeholder="Filter categories…"
          aria-label="Filter categories"
        />
        {!facets ? (
          <SkeletonRows n={6} />
        ) : fsgOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No categories match.</p>
        ) : (
          <ScrollArea className="rounded-lg border [&_[data-slot=scroll-area-viewport]]:max-h-56">
            <div className="space-y-0.5 p-1.5">
              {fsgOptions.map((o) => {
                const { code, name } = splitFsgLabel(o.label);
                return (
                  <Label key={o.key} className="cursor-pointer items-start rounded-md px-1.5 py-1.5 font-normal hover:bg-muted" title={o.label}>
                    <Checkbox
                      className="mt-px"
                      checked={filters.fsg.includes(o.key)}
                      onCheckedChange={() => onChange({ fsg: toggle(filters.fsg, o.key) })}
                    />
                    <span className="flex min-w-0 flex-1 items-baseline gap-1.5 leading-snug">
                      <span className="w-4 shrink-0 font-mono text-xs text-muted-foreground">{code}</span>
                      <span className="line-clamp-2">{name || code}</span>
                    </span>
                    <Count n={o.count} />
                  </Label>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </Section>

      <Separator />

      <Section title="Quick filters">
        <div className="space-y-3">
          <Label className="cursor-pointer justify-between font-normal">
            <span>
              Fast award candidates
              <span className="block text-xs text-muted-foreground">May be awarded before the deadline</span>
            </span>
            <span className="flex items-center gap-2">
              <Count n={facets?.fastAward} />
              <Switch checked={filters.fastAward} onCheckedChange={(v) => onChange({ fastAward: v })} />
            </span>
          </Label>
          <Label className="cursor-pointer justify-between font-normal">
            <span>Has technical docs</span>
            <span className="flex items-center gap-2">
              <Count n={facets?.hasDocs} />
              <Switch checked={filters.hasDocs} onCheckedChange={(v) => onChange({ hasDocs: v })} />
            </span>
          </Label>
          <Label className="cursor-pointer justify-between font-normal">
            <span>Show closed</span>
            <Switch checked={filters.includeClosed} onCheckedChange={(v) => onChange({ includeClosed: v })} />
          </Label>
        </div>
      </Section>

      <Separator />

      <Section title="Issued" hint="Day the RFQ was posted">
        {!facets ? (
          <SkeletonRows n={2} />
        ) : issuedOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No dates available.</p>
        ) : (
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={1}
            className="flex-wrap"
            value={sameDay ? [sameDay] : []}
            onValueChange={(v) => onChange(v[0] ? { issuedFrom: v[0], issuedTo: v[0] } : { issuedFrom: null, issuedTo: null })}
            aria-label="Issued date"
          >
            {issuedOptions.map((o) => (
              <ToggleGroupItem key={o.key} value={o.key} className={CHIP}>
                {shortDate(o.key)}
                <span className={CHIP_COUNT}>{fmtInt(o.count)}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </Section>

      <Separator />

      <Section title="Quantity" hint={facets && facets.qty.max > 0 ? `Range in view: ${fmtInt(facets.qty.min)} to ${fmtInt(facets.qty.max)}` : undefined}>
        <div className="flex items-center gap-2">
          <QtyInput label="Minimum quantity" placeholder="Min" value={filters.qtyMin} onCommit={(v) => onChange({ qtyMin: v })} />
          <span className="text-muted-foreground" aria-hidden>
            –
          </span>
          <QtyInput label="Maximum quantity" placeholder="Max" value={filters.qtyMax} onCommit={(v) => onChange({ qtyMax: v })} />
        </div>
      </Section>
    </div>
  );
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}
