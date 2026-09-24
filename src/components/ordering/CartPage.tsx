"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Armchair, Loader2, PauseCircle, ShoppingBag, Store, UtensilsCrossed } from "lucide-react";

import { getDeviceKey, rememberLastOrder, toOrderLines } from "@/lib/cart";
import { formatPrice, cn } from "@/lib/utils";
import { placeOrder } from "@/app/m/[slug]/cart/actions";
import { QtyStepper } from "./QtyStepper";
import { useCart } from "./CartProvider";

export function CartPage({
  slug,
  currency,
  locale,
  tableToken,
  tableLabel,
  allowTakeaway,
  paused,
  pauseMessage,
  menuHref,
}: {
  slug: string;
  currency: string;
  locale: string;
  tableToken: string | null;
  tableLabel: string | null;
  allowTakeaway: boolean;
  paused: boolean;
  pauseMessage: string | null;
  menuHref: string;
}) {
  const router = useRouter();
  const cart = useCart();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const price = (cents: number) => formatPrice(cents, currency, locale);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await placeOrder({
        slug,
        tableToken,
        serviceType: cart.cart.serviceType,
        note: cart.cart.note,
        lines: toOrderLines(cart.cart),
        deviceKey: getDeviceKey(),
        locale,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      rememberLastOrder(slug, res.code);
      cart.clear();
      router.push(
        `/m/${slug}/order/${res.code}${tableToken ? `?t=${encodeURIComponent(tableToken)}` : ""}`,
      );
    });
  }

  if (!cart.ready) {
    return (
      <p className="py-16 text-center text-sm text-neutral-500">
        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" aria-hidden />
        Loading your order…
      </p>
    );
  }

  if (cart.cart.lines.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 py-16 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-950/50">
          <ShoppingBag className="h-8 w-8" aria-hidden />
        </div>
        <h2 className="text-lg font-bold">Nothing in your order yet</h2>
        <p className="mt-1.5 text-sm text-neutral-500">Add a few dishes from the menu and they&apos;ll show up here.</p>
        <Link
          href={menuHref}
          className="mt-5 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          Browse the menu
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-28">
      {paused ? (
        <p className="flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">Ordering is paused.</span>{" "}
            {pauseMessage ?? "Please ask a member of staff."}
          </span>
        </p>
      ) : null}

      <ul className="divide-y divide-neutral-200 rounded-3xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        {cart.cart.lines.map((line) => (
          <li key={line.key} className="flex gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{line.name}</p>
              {line.optionSummary ? (
                <p className="mt-0.5 text-xs text-neutral-500">{line.optionSummary}</p>
              ) : null}
              <input
                value={line.note ?? ""}
                onChange={(e) => cart.setNote(line.key, e.target.value)}
                maxLength={200}
                placeholder="Note for the kitchen…"
                aria-label={`Note for ${line.name}`}
                className="mt-2 w-full rounded-lg border border-transparent bg-neutral-50 px-2 py-1 text-xs outline-none transition placeholder:text-neutral-400 focus:border-brand-400 focus:bg-white dark:bg-neutral-800 dark:focus:bg-neutral-900"
              />
            </div>
            <div className="flex flex-col items-end justify-between gap-2">
              <span translate="no" className="text-sm font-bold tabular-nums">
                {price(line.unitPriceCents * line.quantity)}
              </span>
              <QtyStepper
                size="sm"
                value={line.quantity}
                onChange={(q) => cart.setQty(line.key, q)}
                removable
                label={line.name}
              />
            </div>
          </li>
        ))}
      </ul>

      {allowTakeaway ? (
        <div role="radiogroup" aria-label="Dine in or takeaway" className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "dine_in", label: "Dine in", icon: UtensilsCrossed },
              { value: "takeaway", label: "Parcel / takeaway", icon: Store },
            ] as const
          ).map((opt) => {
            const on = cart.cart.serviceType === opt.value;
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => cart.setService(opt.value)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-semibold transition",
                  on
                    ? "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-900/30 dark:text-brand-300"
                    : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div>
        <label htmlFor="order-note" className="mb-1 block text-sm font-bold">
          Note for the restaurant <span className="font-normal text-neutral-500">Optional</span>
        </label>
        <textarea
          id="order-note"
          value={cart.cart.note}
          onChange={(e) => cart.setOrderNote(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder="Allergies, timing, anything else…"
          className="w-full resize-y rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/20 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      {tableLabel ? (
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500">
          <Armchair className="h-3.5 w-3.5" aria-hidden />
          Ordering for {tableLabel}. Your waiter will confirm it.
        </p>
      ) : (
        <p className="text-xs text-neutral-500">
          After you place the order, show the code on your screen to your waiter. They&apos;ll add
          your table and confirm it.
        </p>
      )}

      {error ? (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={submit}
          disabled={pending || paused}
          className="pointer-events-auto flex w-full max-w-lg items-center justify-between rounded-full bg-brand-600 px-6 py-4 text-white shadow-2xl shadow-black/30 transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="inline-flex items-center gap-2 text-sm font-bold">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {pending ? "Placing your order…" : `Place order · ${cart.count} ${cart.count === 1 ? "item" : "items"}`}
          </span>
          <span translate="no" className="text-sm font-bold tabular-nums">
            {price(cart.subtotalCents)}
          </span>
        </button>
      </div>
    </div>
  );
}
