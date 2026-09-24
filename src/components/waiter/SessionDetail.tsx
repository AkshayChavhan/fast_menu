"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, ChevronRight, Eraser, Loader2, Plus, Receipt } from "lucide-react";

import { clearSession, resolveRequest } from "@/app/waiter/actions";
import type { SessionDetail as SessionDetailData } from "@/app/waiter/data";
import { useRealtimeRefresh } from "@/lib/realtime";
import { timeAgo } from "@/lib/time";
import { formatPrice, cn } from "@/lib/utils";

const POLL_MS = 8000;

// One bill: its tables, every order on it, the running total, and the two
// things a waiter does here — add another order, or clear a table that
// never ordered. Settling happens at the counter.
export function SessionDetail({
  restaurantId,
  session,
  currency,
  locale,
}: {
  restaurantId: string;
  session: SessionDetailData;
  currency: string;
  locale: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useRealtimeRefresh(
    restaurantId,
    ["orders", "table_sessions", "service_requests"],
    session.status === "closed" ? 0 : POLL_MS,
  );

  const price = (cents: number) => formatPrice(cents, currency, locale);
  const name =
    session.tables.length > 0
      ? session.tables.map((t) => t.label).join(" + ")
      : session.guest_label ?? (session.service_type === "takeaway" ? "Parcel" : "Walk-in");
  const payable = session.orders.filter((o) => o.status === "approved" || o.status === "settled");
  const canClear = session.status !== "closed" && payable.length === 0;
  const newOrderHref = `/waiter/new?tables=${session.tables.map((t) => t.id).join(",")}`;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, then?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Something went wrong");
        return;
      }
      then?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold">{name}</h1>
            <p className="text-xs text-neutral-500">
              {session.guest_label && session.tables.length > 0 ? `${session.guest_label} · ` : ""}
              seated {timeAgo(session.opened_at)} ago
            </p>
          </div>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-bold",
              session.status === "bill_requested"
                ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                : session.status === "closed"
                  ? "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                  : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
            )}
          >
            {session.status === "bill_requested" ? "Bill requested" : session.status === "closed" ? "Paid" : "Open"}
          </span>
        </div>
        <p translate="no" className="mt-3 text-3xl font-extrabold tabular-nums">{price(session.total_cents)}</p>
        <p className="text-xs text-neutral-500">
          {payable.length} {payable.length === 1 ? "order" : "orders"} on this bill · settled at the counter
        </p>
      </div>

      {session.requests.length > 0 ? (
        <ul className="space-y-2">
          {session.requests.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/30"
            >
              {r.kind === "request_bill" ? <Receipt className="h-5 w-5 text-brand-600" aria-hidden /> : <Bell className="h-5 w-5 text-amber-600" aria-hidden />}
              <p className="flex-1 text-sm font-semibold">
                {r.kind === "request_bill" ? "Wants the bill" : "Calling a waiter"}
                <span className="font-normal text-neutral-500"> · {timeAgo(r.created_at)}</span>
              </p>
              <button
                type="button"
                onClick={() => run(() => resolveRequest({ requestId: r.id }))}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm ring-1 ring-neutral-200 hover:bg-neutral-50 disabled:opacity-60 dark:bg-neutral-900 dark:text-neutral-200 dark:ring-neutral-700"
              >
                <Check className="h-3.5 w-3.5" aria-hidden /> Done
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Orders</h2>
        {session.orders.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
            Nothing ordered yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {session.orders.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/waiter/orders/${o.code}`}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 transition hover:border-brand-300 dark:border-neutral-800 dark:bg-neutral-900",
                    o.status === "cancelled" && "opacity-50",
                  )}
                >
                  <span translate="no" className="rounded-lg bg-neutral-100 px-2 py-1 font-mono text-xs font-bold tracking-widest dark:bg-neutral-800">
                    {o.code}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      {o.source === "waiter" ? "by staff" : "by guest"} · {timeAgo(o.created_at)}
                      {o.status === "cancelled" ? " · cancelled" : ""}
                      {o.last_edited_at ? " · edited" : ""}
                    </p>
                  </div>
                  <span translate="no" className="text-sm font-bold tabular-nums">{price(o.subtotal_cents)}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error ? (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {session.status !== "closed" ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href={newOrderHref}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" aria-hidden /> Add an order
          </Link>
          {canClear ? (
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("Clear this table? Use this when guests left without ordering.")) return;
                run(() => clearSession({ sessionId: session.id }), () => router.push("/waiter/tables"));
              }}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Eraser className="h-4 w-4" aria-hidden />}
              Clear table
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
