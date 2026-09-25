"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";

import { reviewTrial } from "@/app/admin/trials/actions";

export interface TrialReviewRow {
  restaurant_id: string;
  name: string;
  slug: string;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  gstin: string | null;
  owner_email: string | null;
  created_at: string;
  lookalikes: { name: string; slug: string; city: string | null; trial_status: string }[];
}

export function TrialReviewList({ rows }: { rows: TrialReviewRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function decide(row: TrialReviewRow, approve: boolean) {
    if (!approve && !window.confirm(`Deny the trial for "${row.name}"? Its dashboard locks immediately.`)) {
      return;
    }
    setBusyId(row.restaurant_id);
    setError(null);
    startTransition(async () => {
      const res = await reviewTrial({ restaurantId: row.restaurant_id, approve });
      setBusyId(null);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-500 dark:border-neutral-700">
        Nothing waiting for review.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <ul className="space-y-3">
        {rows.map((row) => {
          const busy = busyId === row.restaurant_id && pending;
          return (
            <li
              key={row.restaurant_id}
              className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{row.name}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    /m/{row.slug} · {[row.city, row.pincode].filter(Boolean).join(" ") || "no address"}
                  </p>
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-neutral-600 sm:grid-cols-2 dark:text-neutral-300">
                    <Item label="Owner" value={row.owner_email} />
                    <Item label="Phone" value={row.phone ? `+${row.phone}` : null} />
                    <Item label="GSTIN" value={row.gstin} />
                    <Item label="Claimed" value={new Date(row.created_at).toLocaleString()} />
                  </dl>

                  <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <span className="font-semibold">Looks like:</span>{" "}
                    {row.lookalikes.length === 0
                      ? "the earlier claim was removed"
                      : row.lookalikes
                          .map((l) => `${l.name} (/m/${l.slug}${l.city ? `, ${l.city}` : ""}, ${l.trial_status})`)
                          .join("; ")}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin text-neutral-400" aria-hidden /> : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide(row, true)}
                    className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden /> Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide(row, false)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden /> Deny
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-14 shrink-0 text-neutral-400">{label}</dt>
      <dd className="truncate">{value ?? "—"}</dd>
    </div>
  );
}
