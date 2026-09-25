"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChefHat, Flame, Loader2, Printer } from "lucide-react";

import { setItemStatus, setOrderStatus } from "@/app/kitchen/actions";
import type { Ticket } from "@/app/kitchen/data";
import { useRealtimeRefresh } from "@/lib/realtime";
import { clockTime, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { KdsStatus } from "@/types/db";

const POLL_MS = 10000;

type NextState = "preparing" | "ready" | "served";

const NEXT: Record<string, NextState | null> = {
  queued: "preparing",
  preparing: "ready",
  ready: "served",
  served: null,
};

const STATE_LABEL: Record<KdsStatus, string> = {
  queued: "Queued",
  preparing: "Cooking",
  ready: "Ready",
  served: "Served",
};

const STATE_TONE: Record<KdsStatus, string> = {
  queued: "bg-neutral-800 text-neutral-200 ring-neutral-700",
  preparing: "bg-amber-900/60 text-amber-100 ring-amber-700",
  ready: "bg-green-900/60 text-green-100 ring-green-600",
  served: "bg-neutral-900 text-neutral-500 ring-neutral-800 line-through",
};

// Tickets, oldest first, big enough to read across a kitchen. Tap a line to
// move it on (queued → cooking → ready → served); the ticket buttons move
// every line at once. Printing sends just the tapped ticket to the printer.
export function KitchenBoard({ restaurantId, tickets, timezone }: { restaurantId: string; tickets: Ticket[]; timezone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useRealtimeRefresh(restaurantId, ["orders", "order_items"], POLL_MS);

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(id);
    setError(null);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else router.refresh();
    });
  }

  function print(ticketId: string) {
    const root = document.documentElement;
    const el = document.querySelector<HTMLElement>(`[data-ticket="${ticketId}"]`);
    if (!el) return;
    root.setAttribute("data-print-ticket", ticketId);
    el.classList.add("kds-print-me");
    const done = () => {
      root.removeAttribute("data-print-ticket");
      el.classList.remove("kds-print-me");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  }

  if (tickets.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-neutral-700 px-8 py-16 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-950/60 text-brand-400">
          <ChefHat className="h-8 w-8" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold">No tickets</h1>
        <p className="mt-2 text-base text-neutral-400">Approved orders appear here as tickets.</p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          html[data-print-ticket] .kds-ticket[data-ticket] { display: none; }
          html[data-print-ticket] .kds-ticket.kds-print-me,
          html[data-print-ticket] .kds-ticket.kds-print-me * { visibility: visible !important; display: block; }
          html[data-print-ticket] .kds-ticket.kds-print-me {
            position: absolute; left: 0; top: 0; width: 72mm; color: #000; background: #fff;
            border: 0; box-shadow: none; font-size: 12pt;
          }
          .kds-no-print { display: none !important; }
        }
      `}</style>

      {error ? (
        <p role="alert" className="mb-4 rounded-xl bg-red-950/60 px-4 py-2 text-sm text-red-200 ring-1 ring-red-800">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {tickets.map((t) => {
          const ticketBusy = busy === t.id && pending;
          const allQueued = t.items.every((i) => (i.kds_status ?? "queued") === "queued");
          const age = t.approved_at ? timeAgo(t.approved_at) : "";
          return (
            <article
              key={t.id}
              data-ticket={t.id}
              className={cn(
                "kds-ticket flex flex-col rounded-2xl border bg-neutral-900 shadow-lg",
                t.ready ? "border-green-600" : t.items.some((i) => i.kds_status === "preparing") ? "border-amber-600" : "border-neutral-700",
              )}
            >
              <header className="flex items-start justify-between gap-3 border-b border-neutral-800 px-4 py-3">
                <div>
                  <p className="text-2xl font-extrabold leading-tight">{t.where}</p>
                  <p className="mt-0.5 text-sm text-neutral-400">
                    <span translate="no" className="font-mono font-bold text-neutral-300">{t.code}</span>
                    {t.approved_at ? ` · ${clockTime(t.approved_at, timezone)}` : ""} · {age}
                    {t.source === "waiter" ? " · staff" : ""}
                    {t.last_edited_at ? <span className="font-semibold text-amber-300"> · edited</span> : null}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => print(t.id)}
                  aria-label={`Print ticket ${t.code}`}
                  className="kds-no-print inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                >
                  <Printer className="h-4 w-4" aria-hidden />
                </button>
              </header>

              <ul className="flex-1 divide-y divide-neutral-800">
                {t.items.map((i) => {
                  const state = (i.kds_status ?? "queued") as KdsStatus;
                  const next = NEXT[state];
                  const itemBusy = busy === i.id && pending;
                  return (
                    <li key={i.id}>
                      <button
                        type="button"
                        disabled={!next || pending}
                        onClick={() => next && run(i.id, () => setItemStatus({ itemId: i.id, status: next, code: t.code }))}
                        aria-label={next ? `Mark ${i.name} ${STATE_LABEL[next].toLowerCase()}` : `${i.name} served`}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-neutral-800/60 disabled:cursor-default disabled:hover:bg-transparent",
                          state === "served" && "opacity-50",
                        )}
                      >
                        <span className="w-8 shrink-0 text-2xl font-extrabold tabular-nums">{i.quantity}×</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-lg font-bold leading-snug">{i.name}</span>
                          {i.variant || i.addons.length > 0 ? (
                            <span className="block text-sm text-neutral-300">
                              {[i.variant?.name, ...i.addons.map((a) => a.name)].filter(Boolean).join(" · ")}
                            </span>
                          ) : null}
                          {i.note ? <span className="block text-sm font-semibold text-amber-300">“{i.note}”</span> : null}
                        </span>
                        <span className={cn("kds-no-print mt-1 shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ring-1", STATE_TONE[state])}>
                          {itemBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : STATE_LABEL[state]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {t.note ? (
                <p className="border-t border-neutral-800 px-4 py-2 text-sm font-semibold text-amber-300">Guest: “{t.note}”</p>
              ) : null}

              <footer className="kds-no-print flex gap-2 border-t border-neutral-800 p-3">
                {allQueued ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(t.id, () => setOrderStatus({ orderId: t.id, status: "preparing", code: t.code }))}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-3 py-3 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-60"
                  >
                    {ticketBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Flame className="h-4 w-4" aria-hidden />}
                    Start all
                  </button>
                ) : null}
                {!t.ready ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(t.id, () => setOrderStatus({ orderId: t.id, status: "ready", code: t.code }))}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-600 px-3 py-3 text-sm font-bold text-white hover:bg-green-500 disabled:opacity-60"
                  >
                    {ticketBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                    All ready
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(t.id, () => setOrderStatus({ orderId: t.id, status: "served", code: t.code }))}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-neutral-600 px-3 py-3 text-sm font-bold text-neutral-100 hover:bg-neutral-800 disabled:opacity-60"
                  >
                    {ticketBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                    Served · clear
                  </button>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </>
  );
}
