"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { removePlaceholderRestaurant } from "@/app/admin/admins/actions";
import { timeAgo } from "@/lib/time";

export interface PlaceholderRow {
  restaurant_id: string;
  name: string;
  slug: string;
  owner_email: string;
  created_at: string;
}

// Every signup is given a starter restaurant, operators included. Theirs
// sit empty and count as restaurants on /admin until removed here. Only an
// unpublished one with nothing in it is listed, and the database checks
// the same before deleting.
export function PlaceholderRestaurants({ rows }: { rows: PlaceholderRow[] }) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) return null;

  function remove(row: PlaceholderRow) {
    if (!window.confirm(`Remove the empty "${row.name}" (/m/${row.slug}) owned by ${row.owner_email}?`)) return;
    setBusy(row.restaurant_id);
    setError(null);
    startTransition(async () => {
      const res = await removePlaceholderRestaurant({ id: row.restaurant_id });
      setBusy(null);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">
        Placeholder restaurants{" "}
        <span className="font-normal text-neutral-500">({rows.length})</span>
      </h2>
      <p className="text-xs text-neutral-500">
        Every signup gets a starter restaurant, operators included. These are
        empty, unpublished, and owned by someone on the admin list — and they
        count as restaurants on the Restaurants and Plans pages until removed.
      </p>
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <ul
        aria-label="Placeholder restaurants"
        className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900"
      >
        {rows.map((row) => (
          <li key={row.restaurant_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {row.name} <span className="font-normal text-neutral-500">/m/{row.slug}</span>
              </p>
              <p className="text-xs text-neutral-500">
                {row.owner_email} · created {timeAgo(row.created_at)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => remove(row)}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60 dark:text-red-300 dark:hover:bg-red-900/30"
            >
              {busy === row.restaurant_id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              )}
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
