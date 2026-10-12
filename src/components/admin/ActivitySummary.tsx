import Link from "next/link";

import {
  ATTENTION_LABELS,
  LIFECYCLES,
  LIFECYCLE_LABELS,
  PLAN_EXPIRING_DAYS,
  TRIAL_ENDING_DAYS,
  type ActivitySummary,
  type AttentionItem,
  type AttentionKind,
} from "@/lib/admin-activity";
import { cn } from "@/lib/utils";

// What restaurants paid us, in whole rupees: nobody reads paise on a tile.
const rupees = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);

function Tile({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: string | number;
  hint: string;
  tone?: "plain" | "warn";
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold tracking-tight tabular-nums",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>
    </div>
  );
}

export function SummaryTiles({ summary }: { summary: ActivitySummary }) {
  const { byStatus } = summary;
  return (
    <section aria-label="Summary" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile
          label="Restaurants"
          value={summary.total}
          hint={`${summary.live} with a live menu`}
        />
        <Tile
          label="Active this week"
          value={byStatus.active}
          hint={`${byStatus.quiet} quiet · ${byStatus.at_risk} at risk`}
        />
        <Tile
          label="New sign-ups"
          value={summary.signupsThisWeek}
          hint="in the last 7 days"
        />
        <Tile
          label="Trials ending"
          value={summary.trialsEnding}
          hint={`within ${TRIAL_ENDING_DAYS} days, nothing paid`}
          tone={summary.trialsEnding > 0 ? "warn" : "plain"}
        />
        <Tile
          label="Renewals due"
          value={summary.plansExpiring}
          hint={`paid plans ending within ${PLAN_EXPIRING_DAYS} days`}
          tone={summary.plansExpiring > 0 ? "warn" : "plain"}
        />
        <Tile
          label="Received this month"
          value={rupees(summary.paidThisMonthPaise)}
          hint="subscriptions paid through Razorpay"
        />
      </div>

      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 text-center sm:grid-cols-6 dark:border-neutral-800 dark:bg-neutral-800">
        {LIFECYCLES.map((l) => (
          <div key={l} className="bg-white px-2 py-2.5 dark:bg-neutral-900">
            <dt className="text-[11px] font-medium text-neutral-500">{LIFECYCLE_LABELS[l]}</dt>
            <dd className="text-lg font-semibold tabular-nums">{summary.byLifecycle[l]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// Money about to be lost reads red, money to be won amber, housekeeping grey.
const ATTENTION_TONE: Record<AttentionKind, string> = {
  in_grace: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  payment_failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  trial_ending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  checkout_abandoned: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  plan_expiring: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  usage_drop: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  no_orders: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  trial_review: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  not_published: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  trial_not_started: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

export function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <section aria-labelledby="attention-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="attention-heading" className="text-lg font-semibold tracking-tight">
          Needs attention
        </h2>
        <p className="text-xs text-neutral-500">
          {items.length === 0 ? "" : `${items.length} to follow up, most pressing first`}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          Nothing needs a call today.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {items.map((item) => (
            <li
              key={`${item.kind}-${item.restaurantId}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
            >
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  ATTENTION_TONE[item.kind],
                )}
              >
                {ATTENTION_LABELS[item.kind]}
              </span>
              <a
                href={`#r-${item.restaurantId}`}
                className="min-w-0 truncate text-sm font-semibold hover:underline"
              >
                {item.name}
              </a>
              <span className="min-w-0 flex-1 basis-52 text-sm text-neutral-600 dark:text-neutral-300">
                {item.message}
              </span>
              {item.kind === "trial_review" ? (
                <Link
                  href="/admin/trials"
                  className="shrink-0 text-xs font-medium text-brand-600 hover:underline"
                >
                  Review
                </Link>
              ) : item.phone ? (
                <a
                  href={`tel:${item.phone}`}
                  className="shrink-0 text-xs font-medium text-brand-600 hover:underline"
                >
                  {item.phone}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
