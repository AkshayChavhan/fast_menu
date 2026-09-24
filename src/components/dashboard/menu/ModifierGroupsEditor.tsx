"use client";

import { Plus, Trash2 } from "lucide-react";

import type { ModifierGroupInput } from "@/lib/modifiers";
import type { ModifierGroupWithOptions, ModifierKind } from "@/types/db";
import { Switch } from "@/components/dashboard/Switch";
import { cn } from "@/lib/utils";

// Form-side shape of a dish's variants and add-ons. Prices are strings here
// (what the owner types); the server action converts to cents.
export interface DraftOption {
  key: string;
  name: string;
  price: string;
  is_available: boolean;
  is_default: boolean;
}

export interface DraftGroup {
  key: string;
  name: string;
  kind: ModifierKind;
  min_select: number;
  max_select: number | null;
  options: DraftOption[];
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function centsToMajor(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function draftsFromGroups(groups: ModifierGroupWithOptions[]): DraftGroup[] {
  return groups.map((g) => ({
    key: g.id,
    name: g.name,
    kind: g.kind,
    min_select: g.min_select,
    max_select: g.max_select,
    options: g.options.map((o) => ({
      key: o.id,
      name: o.name,
      price: centsToMajor(o.price_cents),
      is_available: o.is_available,
      is_default: o.is_default,
    })),
  }));
}

export function draftsToPayload(groups: DraftGroup[]): ModifierGroupInput[] {
  return groups.map((g) => ({
    name: g.name.trim(),
    kind: g.kind,
    min_select: g.kind === "variant" ? 1 : g.min_select,
    max_select: g.kind === "variant" ? 1 : g.max_select,
    options: g.options.map((o) => ({
      name: o.name.trim(),
      price: o.price.trim() === "" ? "0" : o.price.trim(),
      is_available: o.is_available,
      is_default: g.kind === "variant" && o.is_default,
    })),
  }));
}

function blankGroup(kind: ModifierKind): DraftGroup {
  return {
    key: newKey(),
    name: kind === "variant" ? "Size" : "Add-ons",
    kind,
    min_select: kind === "variant" ? 1 : 0,
    max_select: kind === "variant" ? 1 : null,
    options: [blankOption(kind === "variant")],
  };
}

function blankOption(isDefault = false): DraftOption {
  return { key: newKey(), name: "", price: "", is_available: true, is_default: isDefault };
}

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800";

// Editor for a dish's variant and add-on groups. Everything the guest can
// pick lives here; a dish with no groups has no sheet at all.
export function ModifierGroupsEditor({
  value,
  onChange,
}: {
  value: DraftGroup[];
  onChange: (next: DraftGroup[]) => void;
}) {
  const update = (key: string, patch: Partial<DraftGroup>) =>
    onChange(value.map((g) => (g.key === key ? { ...g, ...patch } : g)));

  const updateOption = (gKey: string, oKey: string, patch: Partial<DraftOption>) =>
    onChange(
      value.map((g) =>
        g.key !== gKey
          ? g
          : {
              ...g,
              options: g.options.map((o) => {
                if (o.key !== oKey) {
                  // Only one default per variant group.
                  return patch.is_default && g.kind === "variant" ? { ...o, is_default: false } : o;
                }
                return { ...o, ...patch };
              }),
            },
      ),
    );

  return (
    <div className="space-y-3">
      {value.map((g) => (
        <div
          key={g.key}
          className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-3 dark:border-neutral-700 dark:bg-neutral-900/40"
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                g.kind === "variant"
                  ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
              )}
            >
              {g.kind === "variant" ? "Pick one" : "Add-ons"}
            </span>
            <input
              value={g.name}
              onChange={(e) => update(g.key, { name: e.target.value })}
              placeholder={g.kind === "variant" ? "Size" : "Extras"}
              aria-label="Group name"
              className={cn(inputClass, "font-semibold")}
            />
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x.key !== g.key))}
              aria-label={`Remove ${g.name || "group"}`}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {g.kind === "addon" ? (
            <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
              <label className="flex items-center gap-1.5">
                At least
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={g.min_select}
                  onChange={(e) =>
                    update(g.key, { min_select: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className={cn(inputClass, "w-16 py-1")}
                  aria-label="Minimum choices"
                />
              </label>
              <label className="flex items-center gap-1.5">
                At most
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={g.max_select ?? ""}
                  placeholder="any"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    update(g.key, { max_select: e.target.value === "" || n < 1 ? null : n });
                  }}
                  className={cn(inputClass, "w-16 py-1")}
                  aria-label="Maximum choices"
                />
              </label>
            </div>
          ) : null}

          <div className="mt-2 space-y-1.5">
            {g.options.map((o) => (
              <div key={o.key} className="flex items-center gap-2">
                {g.kind === "variant" ? (
                  <input
                    type="radio"
                    name={`default-${g.key}`}
                    checked={o.is_default}
                    onChange={() => updateOption(g.key, o.key, { is_default: true })}
                    aria-label={`Make ${o.name || "this option"} the default`}
                    className="h-4 w-4 shrink-0 accent-brand-600"
                    title="Default"
                  />
                ) : (
                  <span className="w-4 shrink-0" aria-hidden />
                )}
                <input
                  value={o.name}
                  onChange={(e) => updateOption(g.key, o.key, { name: e.target.value })}
                  placeholder={g.kind === "variant" ? "Half" : "Extra cheese"}
                  aria-label="Option name"
                  className={inputClass}
                />
                <input
                  value={o.price}
                  onChange={(e) => updateOption(g.key, o.key, { price: e.target.value })}
                  inputMode="decimal"
                  placeholder={g.kind === "variant" ? "Price" : "+0.00"}
                  aria-label={g.kind === "variant" ? "Price" : "Extra price"}
                  className={cn(inputClass, "w-24 text-right tabular-nums")}
                />
                <Switch
                  size="sm"
                  tone="green"
                  checked={o.is_available}
                  onChange={(next) => updateOption(g.key, o.key, { is_available: next })}
                  label={`${o.is_available ? "Mark unavailable" : "Mark available"}: ${o.name || "option"}`}
                />
                <button
                  type="button"
                  onClick={() =>
                    update(g.key, { options: g.options.filter((x) => x.key !== o.key) })
                  }
                  aria-label={`Remove ${o.name || "option"}`}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => update(g.key, { options: [...g.options, blankOption()] })}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add option
            </button>
          </div>

          <p className="mt-2 text-[11px] text-neutral-400">
            {g.kind === "variant"
              ? "The guest picks one. Its price is the price of the dish in that size; the dish's own price is not added."
              : "The guest may pick several. Each price is added to the dish."}
          </p>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange([...value, blankGroup("variant")])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-600 dark:border-neutral-700 dark:text-neutral-300"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Sizes / variants
        </button>
        <button
          type="button"
          onClick={() => onChange([...value, blankGroup("addon")])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-600 dark:border-neutral-700 dark:text-neutral-300"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add-ons
        </button>
      </div>
    </div>
  );
}
