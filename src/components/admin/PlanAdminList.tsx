"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { setRestaurantPlan } from "@/app/admin/plans/actions";
import { PLAN_LABELS, type Plan } from "@/lib/plans";
import { cn } from "@/lib/utils";

export interface PlanRow {
  restaurant_id: string;
  name: string;
  slug: string;
  plan: Plan;
  plan_expires_at: string | null;
  // What they are actually on today — a lapsed pro reads as starter here.
  effective_plan: Plan;
  is_live: boolean;
  is_published: boolean;
  trial_status: string;
  trial_ends_at: string;
  created_at: string;
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function PlanAdminList({ rows }: { rows: PlanRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function apply(row: PlanRow, plan: Plan, months: number) {
    if (
      months === 0 &&
      !window.confirm(
        `End the paid term for "${row.name}"? They lose Pro immediately; the menu stays up for the grace period.`,
      )
    ) {
      return;
    }
    setBusyId(row.restaurant_id);
    setError(null);
    startTransition(async () => {
      const res = await setRestaurantPlan({
        restaurantId: row.restaurant_id,
        plan,
        months,
      });
      setBusyId(null);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-500 dark:border-neutral-700">
        No restaurants yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {rows.map((row) => {
        const busy = busyId === row.restaurant_id;
        // Paid but lapsed: the menu is still up, the features are not.
        const inGrace = row.is_live && row.effective_plan === "starter" && row.is_published;

        return (
          <div
            key={row.restaurant_id}
            className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{row.name}</p>
                <p className="truncate text-xs text-neutral-500">/m/{row.slug}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                    row.effective_plan === "pro"
                      ? "bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300"
                      : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
                  )}
                >
                  {PLAN_LABELS[row.effective_plan]}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    row.is_live
                      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                      : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
                  )}
                >
                  {row.is_live ? "Menu live" : "Dark"}
                </span>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-500 sm:grid-cols-4">
              <div>
                <dt className="font-medium text-neutral-400">Tier set to</dt>
                <dd>{PLAN_LABELS[row.plan]}</dd>
              </div>
              <div>
                <dt className="font-medium text-neutral-400">Paid until</dt>
                <dd>{day(row.plan_expires_at)}</dd>
              </div>
              <div>
                <dt className="font-medium text-neutral-400">Trial</dt>
                <dd>
                  {row.trial_status} · {day(row.trial_ends_at)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-neutral-400">Published</dt>
                <dd>{row.is_published ? "Yes" : "No"}</dd>
              </div>
            </dl>

            {inGrace ? (
              <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                In the grace period — the menu is still up, but Pro features are off.
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin text-neutral-400" aria-label="Saving" />
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => apply(row, "pro", 12)}
                className="rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                Pro · 12 months
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => apply(row, "starter", 12)}
                className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                Starter · 12 months
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => apply(row, row.plan, 1)}
                className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                +1 month
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => apply(row, "starter", 0)}
                className="ml-auto rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40"
              >
                End subscription
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
