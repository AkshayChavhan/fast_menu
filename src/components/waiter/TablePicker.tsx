"use client";

import { Check } from "lucide-react";

import type { RestaurantTable } from "@/types/db";
import { cn } from "@/lib/utils";

// Chips for the restaurant's tables. Tap to select; tap more than one to put
// an order across joined tables. Tables already on a bill show why.
export function TablePicker({
  tables,
  occupied,
  value,
  onChange,
  multiple = true,
}: {
  tables: RestaurantTable[];
  /** table id → short reason it's taken ("on a bill", "bill requested", a guest label). */
  occupied: Record<string, string>;
  value: string[];
  onChange: (next: string[]) => void;
  multiple?: boolean;
}) {
  function toggle(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange(multiple ? [...value, id] : [id]);
    }
  }

  if (tables.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-neutral-300 px-4 py-4 text-center text-xs text-neutral-500 dark:border-neutral-700">
        No tables set up yet. A manager can add them under Tables in the dashboard.
      </p>
    );
  }

  return (
    <div role="group" aria-label="Tables" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {tables.map((t) => {
        const on = value.includes(t.id);
        const taken = occupied[t.id];
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(t.id)}
            className={cn(
              "flex min-h-[3.25rem] flex-col items-center justify-center rounded-2xl border px-2 py-2 text-sm font-bold transition",
              on
                ? "border-brand-500 bg-brand-600 text-white shadow-sm"
                : taken
                  ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
                  : "border-neutral-200 bg-white text-neutral-800 hover:border-brand-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100",
            )}
          >
            <span className="flex items-center gap-1">
              {on ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
              {t.label}
            </span>
            {taken ? (
              <span className={cn("text-[10px] font-medium", on ? "text-white/80" : "text-amber-700 dark:text-amber-300")}>
                {taken}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
