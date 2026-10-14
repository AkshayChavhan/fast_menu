import { ExternalLink } from "lucide-react";

import { percentUsed, toneFor, type Tone } from "@/lib/infra-limits";
import { cn } from "@/lib/utils";

const BAR: Record<Tone, string> = {
  ok: "bg-green-500",
  warn: "bg-amber-500",
  danger: "bg-red-500",
  unknown: "bg-neutral-300 dark:bg-neutral-700",
};

// One meter: used of limit, as a bar. When the vendor keeps the figure to
// itself, the bar is grey and the row links to where it can be seen —
// never a number we do not have.
export function Meter({
  label,
  used,
  limit,
  usedText,
  limitText,
  note,
  dashboard,
}: {
  label: string;
  used: number | null;
  limit: number | null;
  usedText: string;
  limitText: string;
  note?: string | null;
  dashboard?: string;
}) {
  const pct = percentUsed(used, limit);
  const tone = toneFor(pct);
  const remaining =
    used != null && limit != null ? Math.max(0, limit - used) : null;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-neutral-600 dark:text-neutral-300">
          {used == null ? (
            dashboard ? (
              <a
                href={dashboard}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-xs underline"
              >
                Open dashboard <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : (
              <span className="text-xs text-neutral-400">not measurable here</span>
            )
          ) : (
            <>
              {usedText}
              {limit != null ? <span className="text-neutral-400"> / {limitText}</span> : null}
              {pct != null ? <span className="ml-2 text-xs">({pct}%)</span> : null}
            </>
          )}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
      >
        <div className={cn("h-full rounded-full", BAR[tone])} style={{ width: `${pct ?? 0}%` }} />
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 text-xs text-neutral-500">
        <span>
          {used == null ? `Limit ${limitText}` : limit == null ? "No limit on this plan" : null}
          {note ? (used == null || limit == null ? " · " : "") + note : null}
        </span>
        {remaining != null && limit != null ? <span>{percentUsed(remaining, limit)}% left</span> : null}
      </div>
    </div>
  );
}
