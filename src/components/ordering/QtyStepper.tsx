"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Minus / count / plus. At the minimum, minus turns into a bin when
// `removable` so a guest can drop a line from the same control.
export function QtyStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  removable = false,
  size = "md",
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  removable?: boolean;
  size?: "sm" | "md";
  label?: string;
}) {
  const atMin = value <= min;
  const btn =
    size === "sm"
      ? "h-8 w-8"
      : "h-10 w-10";
  return (
    <div
      role="group"
      aria-label={label ? `Quantity of ${label}` : "Quantity"}
      className="inline-flex items-center rounded-full border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
    >
      <button
        type="button"
        onClick={() => onChange(atMin && removable ? 0 : Math.max(min, value - 1))}
        disabled={atMin && !removable}
        aria-label={atMin && removable ? "Remove" : "Decrease"}
        className={cn(
          btn,
          "inline-flex items-center justify-center rounded-full text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-800",
        )}
      >
        {atMin && removable ? <Trash2 className="h-4 w-4" aria-hidden /> : <Minus className="h-4 w-4" aria-hidden />}
      </button>
      <span className="min-w-[2ch] px-1 text-center text-sm font-bold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Increase"
        className={cn(
          btn,
          "inline-flex items-center justify-center rounded-full text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-800",
        )}
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
