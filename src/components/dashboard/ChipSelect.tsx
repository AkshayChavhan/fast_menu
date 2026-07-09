"use client";

import { cn } from "@/lib/utils";

function labelize(value: string): string {
  return value
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Multi-select rendered as toggleable chips. `options` is a readonly string list
// (e.g. ALLERGENS / DIETARY_TAGS); `value` holds the currently-selected subset.
export function ChipSelect({
  options,
  value,
  onChange,
  tone = "brand",
  renderLabel = labelize,
}: {
  options: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  tone?: "brand" | "amber";
  // How to display each option; defaults to title-casing the raw value.
  renderLabel?: (opt: string) => string;
}) {
  const selectedClasses =
    tone === "amber"
      ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300"
      : "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-900/30 dark:text-brand-300";

  function toggle(opt: string) {
    onChange(
      value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt],
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(opt)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? selectedClasses
                : "border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800",
            )}
          >
            {renderLabel(opt)}
          </button>
        );
      })}
    </div>
  );
}

export { labelize };
