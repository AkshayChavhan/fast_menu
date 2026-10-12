"use client";

import { useState } from "react";

import type { ChartData } from "@/lib/insights";
import { cn } from "@/lib/utils";

// A single-series column chart: thin columns on one baseline, hairline grid,
// the tallest column labelled, and the rest read from the tooltip or the table.
//
// Every label arrives already written (see lib/insights.ts). Nothing here
// formats a number or a date, so the server render and the browser agree.
export function ColumnChart({
  data,
  label,
  columns,
}: {
  data: ChartData;
  /** What the chart shows, for screen readers. */
  label: string;
  /** Table headings: what a column is, its value, and the second fact if any. */
  columns: readonly [string, string, string?];
}) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const { points, ticks } = data;
  const top = ticks[ticks.length - 1]?.value || 1;
  const height = (value: number) => `${(value / top) * 100}%`;
  const hasDetail = points.some((p) => p.detail !== "");
  const current = active === null ? null : points[active];

  // Keep a tooltip or cap label inside the plot at either end.
  const edge = (i: number) =>
    i < points.length * 0.2 ? "start" : i >= points.length * 0.8 ? "end" : "middle";

  return (
    <figure>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
          className="rounded-md px-2 py-0.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {asTable ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{label}</caption>
            <thead className="sticky top-0 bg-white text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  {columns[0]}
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                  {columns[1]}
                </th>
                {hasDetail ? (
                  <th scope="col" className="py-1.5 text-right font-medium">
                    {columns[2]}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {points.map((p) => (
                <tr key={p.key}>
                  <th scope="row" className="py-1.5 pr-3 font-normal">
                    {p.title}
                  </th>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{p.valueLabel}</td>
                  {hasDetail ? (
                    <td className="py-1.5 text-right tabular-nums text-neutral-500">{p.detail}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-2">
          {/* Value axis. Twenty pixels of headroom, matching the plot, so the
              top tick lines up with the top gridline. */}
          <div className="relative h-48 w-11 shrink-0" aria-hidden>
            <div className="absolute inset-x-0 bottom-0 top-5">
              {ticks.map((t) => (
                <span
                  key={t.value}
                  className="absolute right-0 translate-y-1/2 whitespace-nowrap text-[10px] tabular-nums text-neutral-500"
                  style={{ bottom: height(t.value) }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="relative h-48">
              <div className="absolute inset-x-0 bottom-0 top-5">
                {ticks.map((t) => (
                  <div
                    key={t.value}
                    aria-hidden
                    className={cn(
                      "absolute inset-x-0 border-t",
                      t.value === 0
                        ? "border-neutral-300 dark:border-neutral-700"
                        : "border-neutral-100 dark:border-neutral-800",
                    )}
                    style={{ bottom: height(t.value) }}
                  />
                ))}

                <div role="list" aria-label={label} className="absolute inset-0 flex gap-0.5">
                  {points.map((p, i) => (
                    // The whole slot is the target, not just the painted
                    // column: a two-pixel bar for a quiet day is still easy
                    // to point at.
                    <div
                      key={p.key}
                      role="listitem"
                      tabIndex={0}
                      aria-label={[p.title, p.valueLabel, p.detail].filter(Boolean).join(", ")}
                      onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)}
                      onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
                      onClick={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                      className="relative flex min-w-0 flex-1 cursor-default items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                    >
                      <div
                        className={cn(
                          "w-full max-w-6 rounded-t transition-colors",
                          active === i ? "bg-brand-700 dark:bg-brand-500" : "bg-brand-600",
                        )}
                        style={{
                          height: height(p.value),
                          minHeight: p.value > 0 ? 2 : 0,
                        }}
                      />
                      {p.peak && active === null ? (
                        <span
                          aria-hidden
                          className={cn(
                            "pointer-events-none absolute mb-1 whitespace-nowrap text-[10px] font-semibold text-neutral-700 dark:text-neutral-200",
                            edge(i) === "start" && "left-0",
                            edge(i) === "middle" && "left-1/2 -translate-x-1/2",
                            edge(i) === "end" && "right-0",
                          )}
                          style={{ bottom: height(p.value) }}
                        >
                          {p.shortValue}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>

                {current && active !== null ? (
                  // The focused column's own label already says all of this
                  // to a screen reader.
                  <div
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute z-10 mb-2 whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-neutral-700 dark:bg-neutral-800",
                      edge(active) === "middle" && "-translate-x-1/2",
                    )}
                    style={{
                      bottom: height(current.value),
                      ...(edge(active) === "end"
                        ? { right: `${((points.length - active - 1) / points.length) * 100}%` }
                        : {
                            left: `${((active + (edge(active) === "middle" ? 0.5 : 0)) / points.length) * 100}%`,
                          }),
                    }}
                  >
                    <p className="font-semibold text-neutral-900 dark:text-neutral-50">
                      {current.valueLabel}
                    </p>
                    <p className="text-neutral-500">{current.title}</p>
                    {current.detail ? <p className="text-neutral-500">{current.detail}</p> : null}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Category axis. Labels are wider than their columns, so they
                hang off the centre of the slot; the first and last are pinned
                to the plot's edges instead of poking out of the card. */}
            <div className="mt-1.5 flex gap-0.5" aria-hidden>
              {points.map((p, i) => (
                <div key={p.key} className="relative h-4 min-w-0 flex-1">
                  {p.axisLabel ? (
                    <span
                      className={cn(
                        "absolute whitespace-nowrap text-[10px] text-neutral-500",
                        i === 0
                          ? "left-0"
                          : i === points.length - 1
                            ? "right-0"
                            : "left-1/2 -translate-x-1/2",
                      )}
                    >
                      {p.axisLabel}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </figure>
  );
}
