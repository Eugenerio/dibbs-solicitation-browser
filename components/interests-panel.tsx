"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FSG_NAMES } from "@/lib/rfq/fsc";
import { emptyInterests, interestCount, STARTER_PROFILES, type Interests } from "@/lib/ui/storage";

interface InterestsPanelProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  interests: Interests;
  onChange(next: Interests): void;
}

const FSG_OPTIONS = Object.entries(FSG_NAMES).sort(([a], [b]) => a.localeCompare(b));
const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

export function InterestsPanel({ open, onOpenChange, interests, onChange }: InterestsPanelProps) {
  const [fscText, setFscText] = useState("");
  const [fscError, setFscError] = useState(false);
  const [kwText, setKwText] = useState("");
  const kwRef = useRef<HTMLInputElement>(null);
  const total = interestCount(interests);

  const addFsc = () => {
    const v = fscText.trim();
    if (!/^\d{4}$/.test(v)) {
      setFscError(true);
      return;
    }
    setFscError(false);
    setFscText("");
    if (!interests.fsc.includes(v)) onChange({ ...interests, fsc: [...interests.fsc, v] });
  };

  const addKw = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 2 && s.length <= 40);
    if (parts.length) onChange({ ...interests, kw: [...new Set([...interests.kw, ...parts])] });
    setKwText("");
  };

  const onKwKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKw(kwText);
    } else if (e.key === "Backspace" && !kwText && interests.kw.length) {
      onChange({ ...interests, kw: interests.kw.slice(0, -1) });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-4 pr-12">
          <SheetTitle className="text-base">Pin interests (optional)</SheetTitle>
          <SheetDescription>We already learn from your activity. Pin categories or keywords here to always boost them.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Quick picks</h3>
            <div className="flex flex-wrap gap-2">
              {STARTER_PROFILES.map((p) => {
                const active = p.fsg.every((g) => interests.fsg.includes(g));
                return (
                  <Button
                    key={p.id}
                    variant={active ? "default" : "outline"}
                    title={p.hint}
                    aria-pressed={active}
                    onClick={() =>
                      onChange({
                        ...interests,
                        fsg: active ? interests.fsg.filter((g) => !p.fsg.includes(g)) : [...new Set([...interests.fsg, ...p.fsg])],
                      })
                    }
                  >
                    {active && <Check aria-hidden />}
                    {p.label}
                  </Button>
                );
              })}
            </div>
          </section>

          <Separator />

          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Categories you supply</h3>
              <span className="text-xs text-muted-foreground">{interests.fsg.length} selected</span>
            </div>
            {interests.fsg.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {[...interests.fsg].sort().map((g) => (
                  <RemovableChip
                    key={g}
                    label={FSG_NAMES[g] ? `${g} ${FSG_NAMES[g]}` : `Group ${g}`}
                    onRemove={() => onChange({ ...interests, fsg: interests.fsg.filter((x) => x !== g) })}
                  />
                ))}
              </div>
            )}
            <Command className="h-72 rounded-lg border">
              <CommandInput placeholder="Search supply groups…" />
              <CommandList className="max-h-none flex-1">
                <CommandEmpty>No category found.</CommandEmpty>
                {FSG_OPTIONS.map(([key, name]) => {
                  const selected = interests.fsg.includes(key);
                  return (
                    <CommandItem
                      key={key}
                      value={`${key} ${name}`}
                      data-checked={selected}
                      onSelect={() => onChange({ ...interests, fsg: toggle(interests.fsg, key) })}
                    >
                      <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{key}</span>
                      <span className="truncate">{name}</span>
                    </CommandItem>
                  );
                })}
              </CommandList>
            </Command>
          </section>

          <section className="space-y-2">
            <Label htmlFor="int-fsc" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Specific classes (optional)
            </Label>
            <div className="flex gap-2">
              <Input
                id="int-fsc"
                inputMode="numeric"
                maxLength={4}
                value={fscText}
                aria-invalid={fscError}
                placeholder="4-digit FSC, e.g. 5935"
                onChange={(e) => {
                  setFscText(e.target.value.replace(/\D/g, ""));
                  setFscError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addFsc();
                  }
                }}
              />
              <Button variant="outline" onClick={addFsc} disabled={fscText.length === 0}>
                Add
              </Button>
            </div>
            {fscError && <p className="text-xs text-destructive">A class code is exactly 4 digits.</p>}
            {interests.fsc.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {interests.fsc.map((c) => (
                  <RemovableChip key={c} label={`Class ${c}`} onRemove={() => onChange({ ...interests, fsc: interests.fsc.filter((x) => x !== c) })} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <Label htmlFor="int-kw" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Keywords
            </Label>
            <Input
              id="int-kw"
              ref={kwRef}
              value={kwText}
              placeholder="e.g. valve, connector - press Enter"
              onChange={(e) => setKwText(e.target.value)}
              onKeyDown={onKwKey}
              onBlur={() => kwText.trim() && addKw(kwText)}
            />
            <p className="text-xs text-muted-foreground">Matched against the item name (word start), so “valve” hits “VALVE, GATE”.</p>
            {interests.kw.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {interests.kw.map((k) => (
                  <RemovableChip key={k} label={k} onRemove={() => onChange({ ...interests, kw: interests.kw.filter((x) => x !== k) })} />
                ))}
              </div>
            )}
          </section>
        </div>

        <SheetFooter className="flex-row items-center justify-between border-t p-3">
          <Button variant="ghost" onClick={() => onChange(emptyInterests())} disabled={total === 0}>
            Clear all
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function RemovableChip({ label, onRemove }: { label: string; onRemove(): void }) {
  return (
    <Badge variant="secondary" className="h-6 max-w-full gap-1 pr-0.5 pl-2.5">
      <span className="truncate">{label}</span>
      <Button variant="ghost" size="icon-xs" className="size-5 rounded-full" aria-label={`Remove ${label}`} onClick={onRemove}>
        <X className="size-3" />
      </Button>
    </Badge>
  );
}
