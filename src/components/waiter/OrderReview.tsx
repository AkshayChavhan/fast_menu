"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Check,
  ChefHat,
  Loader2,
  Pencil,
  Store,
  UtensilsCrossed,
  X,
} from "lucide-react";

import {
  approveOrder,
  cancelStaffOrder,
  moveOrder,
  rejectOrder,
} from "@/app/waiter/actions";
import { setOrderStatus } from "@/app/kitchen/actions";
import type { OrderDetail } from "@/app/waiter/data";
import { useRealtimeRefresh } from "@/lib/realtime";
import { timeAgo } from "@/lib/time";
import { formatPrice, cn } from "@/lib/utils";
import type { KdsStatus, RestaurantTable, ServiceType } from "@/types/db";
import { TablePicker } from "./TablePicker";

const POLL_MS = 6000;

const STATUS_LABEL: Record<OrderDetail["status"], string> = {
  placed: "Waiting for approval",
  approved: "Approved",
  settled: "Paid",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<OrderDetail["status"], string> = {
  placed: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  settled: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  cancelled: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
};

export function OrderReview({
  restaurantId,
  order,
  tables,
  occupied,
  currency,
  locale,
  kdsEnabled = false,
}: {
  restaurantId: string;
  order: OrderDetail;
  tables: RestaurantTable[];
  occupied: Record<string, string>;
  currency: string;
  locale: string;
  kdsEnabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initialTables = order.session?.tables.map((t) => t.id) ?? (order.table_id ? [order.table_id] : []);
  const [tableIds, setTableIds] = useState<string[]>(initialTables);
  const [serviceType, setServiceType] = useState<ServiceType>(order.service_type);
  const [guestLabel, setGuestLabel] = useState(order.session?.guest_label ?? "");
  const [moving, setMoving] = useState(false);

  const live = order.status === "placed" || order.status === "approved";
  useRealtimeRefresh(restaurantId, ["orders", "order_items"], live ? POLL_MS : 0);

  const price = (cents: number) => formatPrice(cents, currency, locale);
  const count = order.items.reduce((n, i) => n + i.quantity, 0);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Something went wrong");
        return;
      }
      after?.();
      router.refresh();
    });
  }

  const approve = () =>
    run(() =>
      approveOrder({ orderId: order.id, code: order.code, tableIds, serviceType, guestLabel }),
    );

  const reject = () => {
    const reason = window.prompt("Tell the guest why (optional):", "") ?? null;
    if (reason === null) return;
    run(() => rejectOrder({ orderId: order.id, code: order.code, reason }));
  };

  const cancel = () => {
    if (!window.confirm("Cancel this order? It will drop off the bill.")) return;
    run(() => cancelStaffOrder({ orderId: order.id, code: order.code, reason: "" }));
  };

  const move = () =>
    run(
      () => moveOrder({ orderId: order.id, code: order.code, tableIds, serviceType, guestLabel }),
      () => setMoving(false),
    );

  const needsTable = serviceType === "dine_in" && tableIds.length === 0;
  const anyReady = kdsEnabled && order.items.some((i) => i.kds_status === "ready");
  const markServed = () =>
    run(() => setOrderStatus({ orderId: order.id, status: "served", code: order.code }));

  return (
    <div className="space-y-5 pb-28">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span translate="no" className="rounded-xl bg-neutral-900 px-3 py-2 font-mono text-lg font-bold tracking-widest text-white dark:bg-white dark:text-neutral-900">
          {order.code}
        </span>
        <div className="min-w-0 flex-1">
          <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-bold", STATUS_TONE[order.status])}>
            {STATUS_LABEL[order.status]}
          </span>
          <p className="mt-1 text-xs text-neutral-500">
            {order.source === "waiter" ? "Taken by staff" : "Placed by the guest"} · {timeAgo(order.created_at)} ago
            {order.last_edited_at ? " · edited" : ""}
          </p>
          {order.session ? (
            <p className="mt-0.5 text-sm font-semibold">
              {order.session.tables.length > 0
                ? order.session.tables.map((t) => t.label).join(" + ")
                : order.session.service_type === "takeaway"
                  ? `Parcel${order.session.guest_label ? ` · ${order.session.guest_label}` : ""}`
                  : order.session.guest_label ?? "Walk-in"}
            </p>
          ) : order.table_label ? (
            <p className="mt-0.5 text-sm font-semibold">Guest scanned {order.table_label}</p>
          ) : null}
        </div>
      </div>

      {/* Items */}
      <section className="rounded-3xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {order.items.map((item) => (
            <li key={item.id} className="flex gap-3 px-4 py-3">
              <span className="w-7 shrink-0 text-base font-bold tabular-nums">{item.quantity}×</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{item.name}</p>
                {item.variant || item.addons.length > 0 ? (
                  <p className="text-xs text-neutral-500">
                    {[item.variant?.name, ...item.addons.map((a) => a.name)].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {item.note ? <p className="text-xs font-medium text-amber-700 dark:text-amber-300">“{item.note}”</p> : null}
                {kdsEnabled && item.kds_status ? <KdsChip status={item.kds_status} /> : null}
              </div>
              <span translate="no" className="text-sm font-semibold tabular-nums">{price(item.line_total_cents)}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <span className="text-sm font-bold">
            {count} {count === 1 ? "item" : "items"}
          </span>
          <span translate="no" className="text-base font-extrabold tabular-nums">{price(order.subtotal_cents)}</span>
        </div>
        {order.note ? (
          <p className="border-t border-neutral-100 px-4 py-3 text-sm text-amber-800 dark:border-neutral-800 dark:text-amber-200">
            Guest says: “{order.note}”
          </p>
        ) : null}
        {order.rejected_reason ? (
          <p className="border-t border-neutral-100 px-4 py-3 text-sm text-red-700 dark:border-neutral-800 dark:text-red-300">
            Rejected: {order.rejected_reason}
          </p>
        ) : null}
      </section>

      {/* Table / service picker: on approval, or when moving an approved order */}
      {order.status === "placed" || (order.status === "approved" && moving) ? (
        <section className="space-y-3">
          <div role="radiogroup" aria-label="Dine in or parcel" className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "dine_in", label: "Dine in", icon: UtensilsCrossed },
                { value: "takeaway", label: "Parcel", icon: Store },
              ] as const
            ).map((opt) => {
              const on = serviceType === opt.value;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setServiceType(opt.value)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-sm font-semibold transition",
                    on
                      ? "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-900/30 dark:text-brand-300"
                      : "border-neutral-200 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {opt.label}
                </button>
              );
            })}
          </div>

          {serviceType === "dine_in" ? (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
                Table {tableIds.length > 1 ? `· ${tableIds.length} joined` : ""}
              </p>
              <TablePicker tables={tables} occupied={occupied} value={tableIds} onChange={setTableIds} />
              <p className="mt-1.5 text-[11px] text-neutral-400">
                Tap more than one table to put this on a joined bill.
              </p>
            </div>
          ) : (
            <input
              value={guestLabel}
              onChange={(e) => setGuestLabel(e.target.value)}
              maxLength={80}
              placeholder="Name for the parcel (e.g. Ravi)"
              aria-label="Guest name"
              className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/20 dark:border-neutral-700 dark:bg-neutral-900"
            />
          )}
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {/* Secondary actions for approved orders */}
      {order.status === "approved" && !moving ? (
        <div className="flex flex-wrap gap-2">
          {anyReady ? (
            <button
              type="button"
              onClick={markServed}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
            >
              <ChefHat className="h-4 w-4" aria-hidden /> Mark served
            </button>
          ) : null}
          <Link
            href={`/waiter/orders/${order.code}/edit`}
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            <Pencil className="h-4 w-4" aria-hidden /> Edit items
          </Link>
          <button
            type="button"
            onClick={() => setMoving(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden /> Move table
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/60 dark:bg-neutral-900 dark:text-red-300"
          >
            <X className="h-4 w-4" aria-hidden /> Cancel order
          </button>
        </div>
      ) : null}

      {/* Primary action bar */}
      {order.status === "placed" ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center px-4 pb-3">
          <div className="pointer-events-auto flex w-full max-w-lg gap-2">
            <button
              type="button"
              onClick={reject}
              disabled={pending}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-neutral-300 bg-white px-5 py-4 text-sm font-bold text-neutral-700 shadow-lg hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            >
              <X className="h-4 w-4" aria-hidden /> Reject
            </button>
            <button
              type="button"
              onClick={approve}
              disabled={pending || needsTable}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-green-600 px-5 py-4 text-sm font-bold text-white shadow-lg transition hover:bg-green-700 disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              {needsTable ? "Pick a table" : "Approve"}
            </button>
          </div>
        </div>
      ) : null}

      {order.status === "approved" && moving ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center px-4 pb-3">
          <div className="pointer-events-auto flex w-full max-w-lg gap-2">
            <button
              type="button"
              onClick={() => {
                setMoving(false);
                setTableIds(initialTables);
                setServiceType(order.service_type);
              }}
              className="inline-flex items-center justify-center rounded-full border border-neutral-300 bg-white px-5 py-4 text-sm font-bold text-neutral-700 shadow-lg hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={move}
              disabled={pending || needsTable}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-brand-600 px-5 py-4 text-sm font-bold text-white shadow-lg transition hover:bg-brand-700 disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRightLeft className="h-4 w-4" aria-hidden />}
              Move here
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const KDS_LABEL: Record<KdsStatus, string> = {
  queued: "In the queue",
  preparing: "Cooking",
  ready: "Ready to serve",
  served: "Served",
};

function KdsChip({ status }: { status: KdsStatus }) {
  return (
    <span
      className={cn(
        "mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold",
        status === "ready"
          ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
          : status === "preparing"
            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
            : status === "served"
              ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
              : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
      )}
    >
      {KDS_LABEL[status]}
    </span>
  );
}
