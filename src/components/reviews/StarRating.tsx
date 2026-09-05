"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { REVIEW_MAX_STARS } from "@/lib/constants";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-4 w-4",
  md: "h-7 w-7",
  lg: "h-9 w-9",
} as const;

// Star rating used both as an input (guest picking a score) and as a read-only
// display (dashboard moderation list, floating words on the menu).
//
// Interactive mode is a radiogroup rather than a row of buttons: arrow keys
// move between scores and only the selected star is a tab stop, which is what
// a screen-reader user expects from a rating control.
export function StarRating({
  value,
  onChange,
  size = "md",
  label,
  className,
}: {
  value: number;
  onChange?: (next: number) => void;
  size?: keyof typeof SIZES;
  label?: string;
  className?: string;
}) {
  const [hovered, setHovered] = useState(0);
  const readOnly = !onChange;
  // Hover previews the score you'd get by clicking, without committing it.
  const shown = hovered || value;

  if (readOnly) {
    return (
      <span
        className={cn("inline-flex items-center gap-0.5", className)}
        aria-label={`${value} out of ${REVIEW_MAX_STARS} stars`}
      >
        {Array.from({ length: REVIEW_MAX_STARS }, (_, i) => (
          <Star
            key={i}
            aria-hidden
            className={cn(
              SIZES[size],
              i < Math.round(value)
                ? "fill-amber-400 text-amber-400"
                : "fill-transparent text-neutral-300 dark:text-neutral-600",
            )}
          />
        ))}
      </span>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex items-center gap-1", className)}
      onMouseLeave={() => setHovered(0)}
    >
      {Array.from({ length: REVIEW_MAX_STARS }, (_, i) => {
        const score = i + 1;
        const lit = score <= shown;
        const selected = score === value;
        return (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${score} star${score === 1 ? "" : "s"}`}
            // Roving tabindex: the group is a single tab stop. Before anything
            // is picked, the first star is the entry point.
            tabIndex={selected || (value === 0 && score === 1) ? 0 : -1}
            onClick={() => onChange(score)}
            onMouseEnter={() => setHovered(score)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                e.preventDefault();
                onChange(Math.min(REVIEW_MAX_STARS, (value || 0) + 1));
              } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                e.preventDefault();
                onChange(Math.max(1, (value || 1) - 1));
              }
            }}
            className="rounded-full p-0.5 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Star
              aria-hidden
              className={cn(
                SIZES[size],
                "transition-colors",
                lit
                  ? "fill-amber-400 text-amber-400"
                  : "fill-transparent text-neutral-300 dark:text-neutral-600",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
