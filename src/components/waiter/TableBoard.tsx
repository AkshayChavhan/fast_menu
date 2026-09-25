"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Armchair, Bell, Loader2, Receipt } from "lucide-react";

import { seatTables } from "@/app/waiter/actions";
import type { BoardTable } from "@/app/waiter/data";
import { useRealtimeRefresh } from "@/lib/realtime";
import { timeAgo } from "@/lib/time";
import { formatPrice, cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ordering/BottomSheet";
import { TablePicker } from "./TablePicker";

const POLL_MS = 8000;

// Every table at a glance: free, seated (with the running total), asking
// for the bill, or calling. Tap a free table to seat guests; tap a taken
// one to open its bill.
export function TableBoard({
  restaurantId,
  tables,
  currency,
  locale,
}: {
  restaurantId: string;
  tables: BoardTable[];
  currency: string;
  locale: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [seating, setSeating] = useState<string | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [guestLabel, setGuestLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  useRealtimeRefresh(restaurantId, ["table_sessions", "service_requests", "orders"], POLL_MS);

  const price = (cents: number) => formatPrice(cents, currency, locale);
  const free = tables.filter((t) => !t.session);
  const occupied: Record<string, string> = Object.fromEntries(
    tables.filter((t) => t.session).map((t) => [t.id, t.session!.guest_label ?? "taken"]),
  );

  function seat() {
    if (!seating) return;
    setError(null);
    startTransition(async () => {
      const res = await seatTables({ restaurantId, tableIds: [seating, ...extra], guestLabel });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSeating(null);
      setExtra([]);
      setGuestLabel("");
      router.refresh();
    });
  }

  if (tables.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-neutral-300 px-6 py-14 text-center text-sm text-neutral-500 dark:border-neutral-700">
        No tables yet. A manager can add them under Tables in the dashboard.
      </p>
    );
  }

  const seatingTable = tables.find((t) => t.id === seating);

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tables.map((t) => {
          const s = t.session;
          const bill = s?.status === "bill_requested";
          const tone = t.attention
            ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
            : bill
              ? "border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/30"
              : s
                ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
                : "border-dashed border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900/40";
          const body = (
            <>
              <div className="flex items-start justify-between">
                <span className="text-base font-extrabold">{t.label}</span>
                {t.attention === "call_waiter" ? (
                  <Bell className="h-4 w-4 text-amber-600" aria-label="Calling" />
                ) : t.attention === "request_bill" || bill ? (
                  <Receipt className="h-4 w-4 text-brand-600" aria-label="Bill requested" />
                ) : null}
              </div>
              {s ? (
                <>
                  <p className="mt-1 text-xs text-neutral-500">
                    {s.guest_label ?? `${s.orderCount} ${s.orderCount === 1 ? "order" : "orders"}`}
                    {s.tables.length > 1 ? ` · with ${s.tables.filter((x) => x.id !== t.id).map((x) => x.label).join(", ")}` : ""}
                  </p>
                  <p translate="no" className="mt-1 text-sm font-bold tabular-nums">{price(s.total_cents)}</p>
                  <p className="text-[11px] text-neutral-400">{timeAgo(s.opened_at)}</p>
                </>
              ) : (
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-neutral-500">
                  <Armchair className="h-3.5 w-3.5" aria-hidden /> Free
                </p>
              )}
            </>
          );
          const cls = cn("flex min-h-[6rem] flex-col rounded-2xl border p-3 text-left transition", tone);
          return s ? (
            <Link key={t.id} href={`/waiter/sessions/${s.id}`} className={cn(cls, "hover:border-brand-400")}>
              {body}
            </Link>
          ) : (
            <button key={t.id} type="button" onClick={() => setSeating(t.id)} className={cn(cls, "hover:border-brand-400")}>
              {body}
            </button>
          );
        })}
      </div>

      <BottomSheet
        open={seating !== null}
        onClose={() => setSeating(null)}
        title={`Seat guests at ${seatingTable?.label ?? "table"}`}
        footer={
          <button
            type="button"
            onClick={seat}
            disabled={pending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-600 px-5 py-3 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Armchair className="h-4 w-4" aria-hidden />}
            Seat
          </button>
        }
      >
        <div className="space-y-4">
          <input
            value={guestLabel}
            onChange={(e) => setGuestLabel(e.target.value)}
            maxLength={80}
            placeholder="Name or note (optional)"
            aria-label="Guest name"
            className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/20 dark:border-neutral-700 dark:bg-neutral-900"
          />
          {free.length > 1 ? (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Join more tables</p>
              <TablePicker
                tables={free.filter((t) => t.id !== seating)}
                occupied={occupied}
                value={extra}
                onChange={setExtra}
              />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          ) : null}
        </div>
      </BottomSheet>
    </>
  );
}
