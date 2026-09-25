"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, ChevronRight, Loader2, Receipt } from "lucide-react";

import { resolveRequest } from "@/app/waiter/actions";
import type { WaiterHome as WaiterHomeData } from "@/app/waiter/data";
import { useRealtimeRefresh } from "@/lib/realtime";
import { timeAgo } from "@/lib/time";
import { formatPrice, cn } from "@/lib/utils";

const POLL_MS = 6000;

export function WaiterHome({
  restaurantId,
  home,
  currency,
  locale,
}: {
  restaurantId: string;
  home: WaiterHomeData;
  currency: string;
  locale: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useRealtimeRefresh(restaurantId, ["orders", "table_sessions", "service_requests"], POLL_MS);

  const price = (cents: number) => formatPrice(cents, currency, locale);

  function done(requestId: string) {
    setBusyId(requestId);
    setError(null);
    startTransition(async () => {
      const res = await resolveRequest({ requestId });
      setBusyId(null);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {home.requests.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
            Guests need you
          </h2>
          <ul className="space-y-2">
            {home.requests.map((r) => {
              const isBill = r.kind === "request_bill";
              const busy = busyId === r.id && pending;
              return (
                <li
                  key={r.id}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border px-4 py-3",
                    isBill
                      ? "border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/30"
                      : "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30",
                  )}
                >
                  {isBill ? <Receipt className="h-5 w-5 shrink-0 text-brand-600" aria-hidden /> : <Bell className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">
                      {r.table_label ?? "A table"} {isBill ? "wants the bill" : "is calling"}
                    </p>
                    <p className="text-xs text-neutral-500">{timeAgo(r.created_at)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => done(r.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm ring-1 ring-neutral-200 hover:bg-neutral-50 disabled:opacity-60 dark:bg-neutral-900 dark:text-neutral-200 dark:ring-neutral-700"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
                    Done
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {home.placed.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
            Waiting for approval · {home.placed.length}
          </h2>
          <ul className="space-y-2">
            {home.placed.map((o) => {
              const count = o.items.reduce((n, i) => n + i.quantity, 0);
              return (
                <li key={o.id}>
                  <Link
                    href={`/waiter/orders/${o.code}`}
                    className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 transition hover:border-brand-300 dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <span translate="no" className="rounded-lg bg-neutral-900 px-2 py-1 font-mono text-sm font-bold tracking-widest text-white dark:bg-white dark:text-neutral-900">
                      {o.code}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {o.table_label ?? (o.service_type === "takeaway" ? "Parcel" : "No table yet")}
                        <span className="font-normal text-neutral-500"> · {count} {count === 1 ? "item" : "items"}</span>
                      </p>
                      <p className="truncate text-xs text-neutral-500">
                        {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p translate="no" className="text-sm font-bold tabular-nums">{price(o.subtotal_cents)}</p>
                      <p className="text-[11px] text-neutral-500">{timeAgo(o.created_at)}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {home.sessions.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
            Open tables · {home.sessions.length}
          </h2>
          <ul className="space-y-2">
            {home.sessions.map((s) => {
              const name =
                s.tables.length > 0
                  ? s.tables.map((t) => t.label).join(" + ")
                  : s.guest_label ?? (s.service_type === "takeaway" ? "Parcel" : "Walk-in");
              return (
                <li key={s.id}>
                  <Link
                    href={`/waiter/sessions/${s.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 transition hover:border-brand-300 dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {name}
                        {s.guest_label && s.tables.length > 0 ? (
                          <span className="font-normal text-neutral-500"> · {s.guest_label}</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {s.orders.length} {s.orders.length === 1 ? "order" : "orders"} · seated {timeAgo(s.opened_at)} ago
                      </p>
                    </div>
                    {s.status === "bill_requested" ? (
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                        Bill requested
                      </span>
                    ) : null}
                    <p translate="no" className="text-sm font-bold tabular-nums">{price(s.total_cents)}</p>
                    <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
