"use client";

import Link from "next/link";
import { ShoppingBag, ChevronRight } from "lucide-react";

import { formatPrice } from "@/lib/utils";
import { useCart } from "./CartProvider";

// Sticky summary at the bottom of the menu while the cart has something in
// it. Sits above the safe area on phones.
export function CartBar({
  slug,
  currency,
  locale,
  tableToken,
}: {
  slug: string;
  currency: string;
  locale: string;
  tableToken: string | null;
}) {
  const { ready, count, subtotalCents } = useCart();
  if (!ready || count === 0) return null;

  const href = `/m/${slug}/cart${tableToken ? `?t=${encodeURIComponent(tableToken)}` : ""}`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <Link
        href={href}
        className="pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-full bg-neutral-900 px-5 py-3.5 text-white shadow-2xl shadow-black/30 transition hover:bg-neutral-800 dark:bg-brand-600 dark:hover:bg-brand-700"
      >
        <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/15">
          <ShoppingBag className="h-4 w-4" aria-hidden />
          <span className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full bg-brand-500 px-1 text-center text-[11px] font-bold leading-5 dark:bg-white dark:text-brand-700">
            {count}
          </span>
        </span>
        <span className="flex-1 text-sm font-bold">View your order</span>
        <span translate="no" className="text-sm font-bold tabular-nums">
          {formatPrice(subtotalCents, currency, locale)}
        </span>
        <ChevronRight className="h-4 w-4 opacity-70" aria-hidden />
      </Link>
    </div>
  );
}
