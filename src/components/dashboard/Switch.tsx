"use client";

import { cn } from "@/lib/utils";

// Accessible on/off switch. Controlled via `checked` + `onChange`.
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  size = "md",
  tone = "brand",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  size?: "sm" | "md";
  tone?: "brand" | "green";
}) {
  const dims =
    size === "sm"
      ? { track: "h-5 w-9", knob: "h-4 w-4", on: "translate-x-4" }
      : { track: "h-6 w-11", knob: "h-5 w-5", on: "translate-x-5" };

  const onColor = tone === "green" ? "bg-green-500" : "bg-brand-500";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
        dims.track,
        checked ? onColor : "bg-neutral-300 dark:bg-neutral-600",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "inline-block transform rounded-full bg-white shadow transition-transform",
          dims.knob,
          checked ? dims.on : "translate-x-0.5",
        )}
      />
    </button>
  );
}
