import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import type { RankedRow, SplitPart, StatTile } from "@/lib/insights";
import { cn } from "@/lib/utils";

// The parts of the Insights page that are numbers and bars rather than plots.
// None of them hold state, so they render on the server.

export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <p className="text-xs font-medium text-neutral-500">{tile.label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">{tile.value}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-neutral-500">
            {tile.delta ? <DeltaBadge delta={tile.delta} /> : null}
            <span>{tile.hint}</span>
          </p>
        </div>
      ))}
    </div>
  );
}

// Direction is carried by the arrow and the word as well as the colour.
function DeltaBadge({ delta }: { delta: NonNullable<StatTile["delta"]> }) {
  if (delta.direction === "flat") {
    return (
      <span className="inline-flex items-center gap-0.5 font-semibold text-neutral-600 dark:text-neutral-300">
        <Minus className="h-3 w-3" aria-hidden />
        No change
      </span>
    );
  }
  const up = delta.direction === "up";
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-semibold",
        up ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {delta.pct}% {up ? "up" : "down"}
    </span>
  );
}

// A ranked list with a thin bar under each name: the value sits at the end of
// the row, so nothing has to be read off an axis.
export function RankedBars({ rows, empty }: { rows: RankedRow[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">{empty}</p>;
  }
  return (
    <ol className="space-y-3">
      {rows.map((row, i) => (
        <li key={`${i}-${row.name}`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium">{row.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-neutral-500">
              <span className="font-semibold text-neutral-800 dark:text-neutral-100">
                {row.valueLabel}
              </span>
              {row.detail ? ` · ${row.detail}` : ""}
            </span>
          </div>
          <div
            aria-hidden
            className="mt-1.5 h-2 rounded-r bg-brand-600"
            // A sliver even for the smallest, so every row has a mark.
            style={{ width: `${Math.max(row.pct, 1.5)}%` }}
          />
        </li>
      ))}
    </ol>
  );
}

// Two shares of one whole. Validated as a pair for colour-blind readers in
// both themes; each share is also named and given as a percentage below, so
// colour is never the only thing telling them apart.
const SPLIT_FILL = ["bg-brand-600", "bg-[#2a78d6] dark:bg-[#3987e5]"];

export function SplitBar({ parts, label }: { parts: SplitPart[]; label: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (total === 0) {
    return <p className="text-sm text-neutral-500">No orders in the last 30 days.</p>;
  }
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div
        role="img"
        aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.pct}%`).join(", ")}`}
        className="flex h-3 gap-0.5"
      >
        {parts.map((p, i) =>
          p.value > 0 ? (
            <div
              key={p.label}
              className={cn(
                "h-3 min-w-1",
                SPLIT_FILL[i],
                p === shown[0] && "rounded-l",
                p === shown[shown.length - 1] && "rounded-r",
              )}
              style={{ flexGrow: p.value, flexBasis: 0 }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-3 space-y-1.5">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-baseline gap-2 text-sm">
            <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", SPLIT_FILL[i])} />
            {/* Wraps rather than truncates: the label is what tells the two
                colours apart, so it is never cut short. */}
            <span className="min-w-0 flex-1">{p.label}</span>
            <span className="font-semibold tabular-nums">{p.pct}%</span>
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-neutral-500">
              {p.valueLabel}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
