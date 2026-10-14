"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, Minus, Search } from "lucide-react";

import {
  ACTIVITY_STATUSES,
  LIFECYCLE_LABELS,
  STATUS_HELP,
  STATUS_LABELS,
  istDate,
  type ActivityStatus,
  type RestaurantView,
} from "@/lib/admin-activity";
import { publicMenuPath } from "@/lib/paths";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<ActivityStatus, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  quiet: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  at_risk: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  stalled: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  lapsed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

type Filter = ActivityStatus | "all";

// "3 d ago", but not "just now ago".
function ago(iso: string, now: Date): string {
  const t = timeAgo(iso, now);
  return t === "just now" ? t : `${t} ago`;
}

// Where they are with us, in one line.
function planLine(r: RestaurantView): string {
  switch (r.lifecycle) {
    case "trial":
      return `Trial ends ${istDate(r.endsAt)}`;
    case "starter":
    case "pro":
      return `Paid until ${istDate(r.endsAt)}`;
    case "grace":
      return `Ended ${istDate(r.endsAt)} · menu goes dark ${istDate(r.darkAt)}`;
    case "dark":
      return `Ended ${istDate(r.endsAt)}`;
    case "not_started":
      return r.trialStatus === "denied" ? "Trial refused" : "Trial not started";
  }
}

function matches(r: RestaurantView, query: string): boolean {
  if (!query) return true;
  return [r.name, r.slug, r.city, r.phone, r.ownerEmail].some((field) =>
    field?.toLowerCase().includes(query),
  );
}

export function RestaurantActivityList({
  restaurants,
  nowIso,
}: {
  restaurants: RestaurantView[];
  // The moment the server worked the statuses out. Relative times are
  // measured from it rather than from the browser's clock, so "3 d" on the
  // card always agrees with the status badge beside it.
  nowIso: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(ACTIVITY_STATUSES.map((s) => [s, 0])) as Record<
      ActivityStatus,
      number
    >;
    for (const r of restaurants) c[r.status] += 1;
    return c;
  }, [restaurants]);

  const query = search.trim().toLowerCase();
  const shown = restaurants.filter(
    (r) => (filter === "all" || r.status === filter) && matches(r, query),
  );

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: restaurants.length },
    ...ACTIVITY_STATUSES.map((s) => ({ key: s, label: STATUS_LABELS[s], count: counts[s] })),
  ];

  return (
    <section aria-labelledby="restaurants-heading" className="space-y-3">
      <h2 id="restaurants-heading" className="text-lg font-semibold tracking-tight">
        All restaurants
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-pressed={filter === chip.key}
            onClick={() => setFilter(chip.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === chip.key
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800",
            )}
          >
            {chip.label} <span className="tabular-nums opacity-70">{chip.count}</span>
          </button>
        ))}

        <label className="relative ml-auto w-full sm:w-64">
          <span className="sr-only">Search restaurants</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, city, phone or email"
            className="w-full rounded-lg border border-neutral-300 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
      </div>

      <p className="text-xs text-neutral-500">
        {filter === "all"
          ? "Pick a status to see what it means."
          : `${STATUS_LABELS[filter]}: ${STATUS_HELP[filter]}`}
      </p>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-500 dark:border-neutral-700">
          {restaurants.length === 0 ? "No restaurants yet." : "No restaurants match."}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((r) => (
            <RestaurantCard key={r.id} r={r} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RestaurantCard({ r, now }: { r: RestaurantView; now: Date }) {
  // Anyone who can take orders, or ever did: a lapsed Pro restaurant is shown
  // its order history, not told it is on a menu-only plan.
  const hasOrdering = r.effectivePlan === "pro" || r.lastOrderAt !== null;

  return (
    <li
      id={`r-${r.id}`}
      className="scroll-mt-4 rounded-xl border border-neutral-200 bg-white p-4 target:ring-2 target:ring-brand-500 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/admin/restaurants/${r.id}`} className="block truncate font-semibold hover:underline">
            {r.name}
          </Link>
          <p className="truncate text-xs text-neutral-500">
            {[r.city, `signed up ${istDate(r.createdAt)}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {LIFECYCLE_LABELS[r.lifecycle]}
          </span>
          <span
            title={STATUS_HELP[r.status]}
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              STATUS_TONE[r.status],
            )}
          >
            {STATUS_LABELS[r.status]}
          </span>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-xs text-neutral-600 sm:grid-cols-3 dark:text-neutral-300">
        <div>
          <dt className="font-medium text-neutral-400">Plan</dt>
          <dd>{planLine(r)}</dd>
        </div>
        <div>
          <dt className="font-medium text-neutral-400">Contact</dt>
          <dd className="flex flex-col">
            {r.phone ? (
              <a href={`tel:${r.phone}`} className="hover:underline">
                {r.phone}
              </a>
            ) : null}
            {r.ownerEmail ? (
              <a href={`mailto:${r.ownerEmail}`} className="truncate hover:underline">
                {r.ownerEmail}
              </a>
            ) : null}
            {!r.phone && !r.ownerEmail ? "—" : null}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-neutral-400">Orders</dt>
          {hasOrdering ? (
            <dd>
              <span className="tabular-nums">{r.orders7d}</span> in 7 days ·{" "}
              <span className="tabular-nums">{r.orders30d}</span> in 30
              <span className="block text-neutral-500">
                {r.lastOrderAt ? `Last order ${ago(r.lastOrderAt, now)}` : "No orders yet"}
                {r.guestSharePct !== null ? ` · ${r.guestSharePct}% placed by guests` : ""}
              </span>
            </dd>
          ) : (
            <dd>
              Menu only on this plan
              <span className="block text-neutral-500">
                {r.lastActivityAt
                  ? `Menu edited ${ago(r.lastActivityAt, now)}`
                  : "Menu never edited"}
              </span>
            </dd>
          )}
        </div>
      </dl>

      <div className="mt-3">
        <p className="text-xs font-medium text-neutral-400">
          Setup · {r.setupDone} of {r.setup.length}
        </p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {r.setup.map((step) => (
            <li
              key={step.key}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
                step.done
                  ? "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300"
                  : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
              )}
            >
              {step.done ? (
                <Check className="h-3 w-3" aria-hidden />
              ) : (
                <Minus className="h-3 w-3" aria-hidden />
              )}
              {step.label}
              <span className="sr-only">{step.done ? " (done)" : " (not done)"}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-medium">
        {r.isLive ? (
          <a
            href={publicMenuPath(r.slug)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-brand-600 hover:underline"
          >
            Open menu <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : (
          <span className="text-neutral-400">Menu not reachable</span>
        )}
        <Link href="/admin/plans" className="text-brand-600 hover:underline">
          Change plan
        </Link>
      </div>
    </li>
  );
}
