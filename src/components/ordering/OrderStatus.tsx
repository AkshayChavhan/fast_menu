"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  PartyPopper,
  Pencil,
  ScanLine,
  Star,
  XCircle,
} from "lucide-react";

import { forgetLastOrder, getDeviceKey } from "@/lib/cart";
import { formatPrice, cn } from "@/lib/utils";
import type { PublicOrder } from "@/types/db";
import { cancelOrder } from "@/app/m/[slug]/cart/actions";
import { useCart } from "./CartProvider";

const POLL_MS = 5000;

// The guest's order page. While the waiter has not acted, it is a QR to be
// scanned; afterwards it tracks the table and the bill; when paid it thanks
// the guest and points at Google reviews.
export function OrderStatus({
  order,
  slug,
  locale,
  scanUrl,
  menuHref,
  tableToken,
  googleReviewUrl,
  restaurantName,
}: {
  order: PublicOrder;
  slug: string;
  locale: string;
  scanUrl: string;
  menuHref: string;
  tableToken: string | null;
  googleReviewUrl: string | null;
  restaurantName: string;
}) {
  const router = useRouter();
  const cart = useCart();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const price = (cents: number) => formatPrice(cents, order.currency, locale);
  const paid = order.status === "settled" || order.session_status === "closed";
  const live = !paid && (order.status === "placed" || order.status === "approved");

  // Keep polling while the waiter or the counter can still change things.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [live, router]);

  // Put the lines back in the cart and withdraw the order, so the guest can
  // change their mind before the waiter approves.
  function changeOrder() {
    setError(null);
    startTransition(async () => {
      const res = await cancelOrder({ slug, code: order.code, deviceKey: getDeviceKey() });
      if (!res.ok) {
        setError("This order can't be changed any more. Please ask your waiter.");
        router.refresh();
        return;
      }
      for (const item of order.items) {
        // A dish deleted since the order was placed cannot be re-added.
        if (!item.dish_id) continue;
        cart.add({
          dishId: item.dish_id,
          name: item.name,
          unitPriceCents: item.unit_price_cents,
          quantity: item.quantity,
          note: item.note,
          variantOptionId: item.variant?.option_id ?? null,
          addonOptionIds: item.addons.map((a) => a.option_id),
          optionSummary: [item.variant?.name, ...item.addons.map((a) => a.name)]
            .filter(Boolean)
            .join(" · "),
        });
      }
      forgetLastOrder(slug);
      router.push(`/m/${slug}/cart${tableToken ? `?t=${encodeURIComponent(tableToken)}` : ""}`);
    });
  }

  const qrSrc = `/api/qr?url=${encodeURIComponent(scanUrl)}&size=512`;

  return (
    <div className="space-y-5">
      <StatusCard order={order} paid={paid} />

      {order.status === "placed" ? (
        <section className="rounded-3xl border border-neutral-200 bg-white p-5 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            <ScanLine className="h-4 w-4" aria-hidden /> Show this to your waiter
          </p>
          <div className="mx-auto mt-3 w-56 rounded-2xl bg-white p-2 ring-1 ring-neutral-200">
            {/* eslint-disable-next-line @next/next/no-img-element -- our own route */}
            <img src={qrSrc} alt={`QR code for order ${order.code}`} width={208} height={208} className="h-52 w-52" />
          </div>
          <p translate="no" className="mt-3 font-mono text-3xl font-extrabold tracking-[0.3em] text-neutral-900 dark:text-neutral-50">
            {order.code}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            If the camera doesn&apos;t work, your waiter can type this code.
          </p>
        </section>
      ) : null}

      <section className="rounded-3xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {order.items.map((item) => (
            <li key={item.id} className="flex gap-3 px-4 py-3">
              <span className="w-6 shrink-0 text-sm font-bold tabular-nums text-neutral-500">
                {item.quantity}×
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{item.name}</p>
                {item.variant || item.addons.length > 0 ? (
                  <p className="text-xs text-neutral-500">
                    {[item.variant?.name, ...item.addons.map((a) => a.name)].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {item.note ? <p className="text-xs italic text-neutral-500">“{item.note}”</p> : null}
              </div>
              <span translate="no" className="text-sm font-semibold tabular-nums">
                {price(item.line_total_cents)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <span className="text-sm font-bold">Total</span>
          <span translate="no" className="text-base font-extrabold tabular-nums">
            {price(order.subtotal_cents)}
          </span>
        </div>
        {order.note ? (
          <p className="border-t border-neutral-100 px-4 py-3 text-xs text-neutral-500 dark:border-neutral-800">
            Note: {order.note}
          </p>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {order.status === "placed" ? (
          <button
            type="button"
            onClick={changeOrder}
            disabled={pending}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white px-5 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Pencil className="h-4 w-4" aria-hidden />}
            Change my order
          </button>
        ) : null}

        {order.status === "approved" && !paid ? (
          <Link
            href={menuHref}
            className="inline-flex items-center justify-center rounded-full bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            Order more
          </Link>
        ) : null}

        {paid && googleReviewUrl ? (
          <a
            href={googleReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            <Star className="h-4 w-4" aria-hidden /> Rate {restaurantName} on Google
            <ExternalLink className="h-3.5 w-3.5 opacity-80" aria-hidden />
          </a>
        ) : null}

        {order.status === "rejected" || order.status === "cancelled" || paid ? (
          <Link
            href={menuHref}
            className="inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white px-5 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            Back to the menu
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function StatusCard({ order, paid }: { order: PublicOrder; paid: boolean }) {
  const table = order.table_label;

  const view = paid
    ? {
        icon: PartyPopper,
        tone: "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300",
        title: "Paid. Thank you!",
        body: "We hope you enjoyed your meal.",
      }
    : order.status === "placed"
      ? {
          icon: Clock,
          tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
          title: "Waiting for your waiter",
          body: table
            ? `We'll confirm your order for ${table} as soon as a waiter scans it.`
            : "A waiter will scan your code, add your table and confirm the order.",
        }
      : order.status === "approved"
        ? {
            icon: CheckCircle2,
            tone: "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300",
            title: table ? `Confirmed for ${table}` : "Confirmed",
            body:
              order.session_status === "bill_requested"
                ? "Your bill is on its way."
                : "Your order has gone to the kitchen. You can add more any time.",
          }
        : order.status === "rejected"
          ? {
              icon: XCircle,
              tone: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
              title: "We couldn't take this order",
              body: order.rejected_reason ?? "Please speak to a member of staff.",
            }
          : {
              icon: XCircle,
              tone: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
              title: "This order was cancelled",
              body: "You can start a new one from the menu.",
            };

  const Icon = view.icon;
  return (
    <section className={cn("flex items-start gap-3 rounded-3xl px-5 py-4", view.tone)}>
      <Icon className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
      <div>
        <h2 className="text-base font-bold">{view.title}</h2>
        <p className="mt-0.5 text-sm opacity-90">{view.body}</p>
      </div>
    </section>
  );
}
