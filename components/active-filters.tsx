"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FSG_NAMES } from "@/lib/rfq/fsc";
import type { RfqFilters } from "@/lib/rfq/types";
import { fmtInt, SET_ASIDE_LABELS, shortDate } from "@/lib/ui/format";

interface ActiveFiltersProps {
  filters: RfqFilters;
  onChange(patch: Partial<RfqFilters>): void;
  onClear(): void;
}

interface Chip {
  id: string;
  label: string;
  remove(): void;
}

function buildChips(f: RfqFilters, onChange: ActiveFiltersProps["onChange"]): Chip[] {
  const chips: Chip[] = [];
  if (f.q) chips.push({ id: "q", label: `Search: “${f.q}”`, remove: () => onChange({ q: "" }) });
  if (f.closesWithin != null)
    chips.push({
      id: "closes",
      label: f.closesWithin === 0 ? "Closes today" : `Closes within ${f.closesWithin} days`,
      remove: () => onChange({ closesWithin: null }),
    });
  for (const a of f.setAside)
    chips.push({ id: `aside:${a}`, label: SET_ASIDE_LABELS[a] ?? a, remove: () => onChange({ setAside: f.setAside.filter((x) => x !== a) }) });
  for (const g of f.fsg)
    chips.push({ id: `fsg:${g}`, label: FSG_NAMES[g] ? `${g} ${FSG_NAMES[g]}` : `Group ${g}`, remove: () => onChange({ fsg: f.fsg.filter((x) => x !== g) }) });
  for (const c of f.fsc)
    chips.push({ id: `fsc:${c}`, label: `Class ${c}`, remove: () => onChange({ fsc: f.fsc.filter((x) => x !== c) }) });
  if (f.fastAward) chips.push({ id: "fast", label: "Fast award", remove: () => onChange({ fastAward: false }) });
  if (f.hasDocs) chips.push({ id: "docs", label: "Has tech docs", remove: () => onChange({ hasDocs: false }) });
  if (f.issuedFrom || f.issuedTo) {
    const a = f.issuedFrom, b = f.issuedTo;
    const label = a && b ? (a === b ? `Issued ${shortDate(a)}` : `Issued ${shortDate(a)} – ${shortDate(b)}`) : a ? `Issued from ${shortDate(a)}` : `Issued by ${shortDate(b!)}`;
    chips.push({ id: "issued", label, remove: () => onChange({ issuedFrom: null, issuedTo: null }) });
  }
  if (f.qtyMin != null || f.qtyMax != null) {
    const { qtyMin: lo, qtyMax: hi } = f;
    const label = lo != null && hi != null ? `Qty ${fmtInt(lo)} – ${fmtInt(hi)}` : lo != null ? `Qty ≥ ${fmtInt(lo)}` : `Qty ≤ ${fmtInt(hi!)}`;
    chips.push({ id: "qty", label, remove: () => onChange({ qtyMin: null, qtyMax: null }) });
  }
  if (f.includeClosed) chips.push({ id: "closed", label: "Including closed", remove: () => onChange({ includeClosed: false }) });
  return chips;
}

export function ActiveFilters({ filters, onChange, onClear }: ActiveFiltersProps) {
  const chips = buildChips(filters, onChange);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((c) => (
        <Badge key={c.id} variant="secondary" className="h-6 max-w-full gap-1 pr-0.5 pl-2.5">
          <span className="truncate">{c.label}</span>
          <Button variant="ghost" size="icon-xs" className="size-5 shrink-0 rounded-full" aria-label={`Remove filter: ${c.label}`} onClick={c.remove}>
            <X className="size-3" />
          </Button>
        </Badge>
      ))}
      {chips.length > 1 && (
        <Button variant="link" size="xs" onClick={onClear}>
          Clear all
        </Button>
      )}
    </div>
  );
}
