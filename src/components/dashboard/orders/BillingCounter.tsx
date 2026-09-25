"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Loader2, Receipt, RotateCcw, Store } from "lucide-react";

import { reopenSession, settleSession } from "@/app/dashboard/orders/actions";
import type { Bill, BillingData } from "@/app/dashboard/orders/data";
import { resolveRequest } from "@/app/waiter/actions";
import { useRealtimeRefresh } from "@/lib/realtime";
import { clockTime, timeAgo } from "@/lib/time";
import { formatPrice, cn } from "@/lib/utils";

export function BillingCounter({
  restaurantId,
  billing,
  currency,
  locale,
  timezone,
  canReopen,
  orderingEnabled,
}: {
  restaurantId: string;
  billing: BillingData;
  currency: string;
  locale: string;
  timezone: string;
  canReopen: boolean;
  orderingEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useRealtimeRefresh(restaurantId, ["orders", "table_sessions", "service_requests"]);

  const price = (cents: number) => formatPrice(cents, currency, locale);

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else router.refresh();
    });
  }

  const markPaid = (bill: Bill) => {
    if (!window.confirm(`Mark ${billName(bill)} as paid (${price(bill.total_cents)})?`)) return;
    run(bill.id, () => settleSession({ sessionId: bill.id }));
  };

  const reopen = (bill: Bill) => {
    if (!window.confirm(`Reopen the bill for ${billName(bill)}? Its orders go back to unpaid.`)) return;
    run(bill.id, () => reopenSession({ sessionId: bill.id }));
  };

  if (!orderingEnabled) {
    return (
      <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-14 text-center text-sm text-neutral-500 dark:border-neutral-700">
        Table ordering is switched off. Turn it on under Settings and bills will appear here.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Open bills" value={String(billing.open.length)} />
        <Stat label="Asking for the bill" value={String(billing.open.filter((b) => b.status === "bill_requested").length)} />
        <Stat label={`Paid today (${billing.today})`} value={price(billing.todayCents)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-neutral-500">
            Open bills · {billing.open.length}
          </h2>
          {billing.open.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-500 dark:border-neutral-700">
              Nothing open. Approved orders show up here the moment a waiter confirms them.
            </p>
          ) : (
            <ul className="space-y-4">
              {billing.open.map((bill) => (
                <li key={bill.id}>
                  <BillCard bill={bill} price={price} timezone={timezone} busy={busyId === bill.id && pending}>
                    <div className="flex flex-wrap items-center gap-2">
                      {bill.requests.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => run(r.id, () => resolveRequest({ requestId: r.id }))}
                          disabled={pending}
                          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
                        >
                          <Bell className="h-3.5 w-3.5" aria-hidden />
                          {r.kind === "request_bill" ? "Bill requested" : "Calling"} · done
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => markPaid(bill)}
                        disabled={pending || bill.orders.length === 0}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
                      >
                        {busyId === bill.id && pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                        Mark paid · {price(bill.total_cents)}
                      </button>
                    </div>
                  </BillCard>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-neutral-500">
            Paid today · {billing.paidToday.length}
          </h2>
          {billing.paidToday.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-500 dark:border-neutral-700">
              No bills settled yet today.
            </p>
          ) : (
            <ul className="space-y-3">
              {billing.paidToday.map((bill) => (
                <li key={bill.id}>
                  <BillCard bill={bill} price={price} timezone={timezone} compact busy={busyId === bill.id && pending}>
                    {canReopen ? (
                      <button
                        type="button"
                        onClick={() => reopen(bill)}
                        disabled={pending}
                        className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 disabled:opacity-60 dark:hover:text-neutral-100"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reopen
                      </button>
                    ) : null}
                  </BillCard>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function billName(bill: Bill): string {
  if (bill.tables.length > 0) return bill.tables.map((t) => t.label).join(" + ");
  return bill.guest_label ?? (bill.service_type === "takeaway" ? "Parcel" : "Walk-in");
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

function BillCard({
  bill,
  price,
  timezone,
  compact = false,
  busy,
  children,
}: {
  bill: Bill;
  price: (cents: number) => string;
  timezone: string;
  compact?: boolean;
  busy: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!compact);
  const orders = bill.orders.filter((o) => o.status !== "cancelled");
  const itemCount = orders.reduce((n, o) => n + o.items.reduce((m, i) => m + i.quantity, 0), 0);

  return (
    <article
      className={cn(
        "rounded-xl border bg-white dark:bg-neutral-900",
        bill.status === "bill_requested"
          ? "border-brand-300 shadow-sm shadow-brand-500/10 dark:border-brand-700"
          : "border-neutral-200 dark:border-neutral-800",
        busy && "opacity-70",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          {bill.service_type === "takeaway" ? <Store className="h-4 w-4" aria-hidden /> : <Receipt className="h-4 w-4" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">{billName(bill)}</span>
            {bill.guest_label && bill.tables.length > 0 ? (
              <span className="text-xs text-neutral-500">{bill.guest_label}</span>
            ) : null}
            {bill.status === "bill_requested" ? (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                Bill requested
              </span>
            ) : null}
          </span>
          <span className="block text-xs text-neutral-500">
            {orders.length} {orders.length === 1 ? "order" : "orders"} · {itemCount} {itemCount === 1 ? "item" : "items"} ·{" "}
            {bill.closed_at ? `paid ${clockTime(bill.closed_at, timezone)}` : `seated ${timeAgo(bill.opened_at)} ago`}
          </span>
        </span>
        <span translate="no" className="text-base font-extrabold tabular-nums">{price(bill.total_cents)}</span>
      </button>

      {open ? (
        <div className="border-t border-neutral-100 dark:border-neutral-800">
          {orders.map((o) => (
            <div key={o.id} className="border-b border-neutral-100 px-4 py-2.5 last:border-b-0 dark:border-neutral-800">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-neutral-500">
                <span translate="no" className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono font-bold tracking-wider dark:bg-neutral-800">
                  {o.code}
                </span>
                <span>{o.source === "waiter" ? "by staff" : "by guest"}</span>
                {o.approved_at ? <span>· {clockTime(o.approved_at, timezone)}</span> : null}
                {o.last_edited_at ? <span className="font-medium text-amber-700 dark:text-amber-300">· edited</span> : null}
                <span translate="no" className="ml-auto font-semibold text-neutral-700 tabular-nums dark:text-neutral-200">
                  {price(o.subtotal_cents)}
                </span>
              </div>
              <ul className="space-y-0.5">
                {o.items.map((i) => (
                  <li key={i.id} className="flex gap-2 text-sm">
                    <span className="w-6 shrink-0 tabular-nums text-neutral-500">{i.quantity}×</span>
                    <span className="min-w-0 flex-1">
                      {i.name}
                      {i.variant || i.addons.length > 0 ? (
                        <span className="text-neutral-500"> · {[i.variant?.name, ...i.addons.map((a) => a.name)].filter(Boolean).join(", ")}</span>
                      ) : null}
                      {i.note ? <span className="italic text-neutral-500"> “{i.note}”</span> : null}
                    </span>
                    <span translate="no" className="tabular-nums">{price(i.line_total_cents)}</span>
                  </li>
                ))}
              </ul>
              {o.note ? <p className="mt-1 text-xs text-neutral-500">Note: {o.note}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">{children}</div>
    </article>
  );
}
