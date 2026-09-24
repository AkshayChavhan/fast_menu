"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Search, Store, UtensilsCrossed, X } from "lucide-react";

import { createStaffOrder, setStaffOrderItems } from "@/app/waiter/actions";
import { toOrderLines, type CartLine } from "@/lib/cart";
import { updateCart } from "@/lib/cart-store";
import { addLine } from "@/lib/cart";
import { formatPrice, cn } from "@/lib/utils";
import type { CategoryView, OrderingInfo } from "@/components/menu/types";
import type { RestaurantTable, ServiceType } from "@/types/db";
import { AddToOrderButton } from "@/components/ordering/AddToOrderButton";
import { QtyStepper } from "@/components/ordering/QtyStepper";
import { useCart } from "@/components/ordering/CartProvider";
import { TablePicker } from "./TablePicker";

export type ComposerMode =
  | { kind: "new"; restaurantId: string }
  | { kind: "edit"; orderId: string; code: string; initialLines: (Omit<CartLine, "key" | "quantity"> & { quantity: number })[] };

// The waiter's menu: a compact, search-first list with steppers, a running
// order on the side, and the table or parcel choice for a brand-new order.
// Reuses the guest's cart store (under a staff-only slug) and option sheet.
export function OrderComposer({
  mode,
  cartSlug,
  categories,
  ordering,
  tables,
  occupied,
}: {
  mode: ComposerMode;
  cartSlug: string;
  categories: CategoryView[];
  ordering: OrderingInfo;
  tables: RestaurantTable[];
  occupied: Record<string, string>;
}) {
  const router = useRouter();
  const cart = useCart();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [tableIds, setTableIds] = useState<string[]>([]);
  const [serviceType, setServiceType] = useState<ServiceType>("dine_in");
  const [guestLabel, setGuestLabel] = useState("");
  const [note, setNote] = useState("");

  // Editing an existing order: seed the composer with its lines once, the
  // first time this browser opens it.
  const seeded = useRef(false);
  useEffect(() => {
    if (mode.kind !== "edit" || seeded.current || !cart.ready) return;
    seeded.current = true;
    if (cart.cart.lines.length > 0) return;
    updateCart(cartSlug, (c) => {
      let next = c;
      for (const line of mode.initialLines) next = addLine(next, line);
      return next;
    });
  }, [mode, cart.ready, cart.cart.lines.length, cartSlug]);

  const price = (cents: number) => formatPrice(cents, ordering.currency, ordering.locale);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    return categories
      .filter((c) => !activeCategory || c.id === activeCategory)
      .map((c) => ({
        ...c,
        dishes: c.dishes.filter((d) => d.isAvailable && (!q || d.searchText.includes(q))),
      }))
      .filter((c) => c.dishes.length > 0);
  }, [categories, activeCategory, q]);

  const needsTable = mode.kind === "new" && serviceType === "dine_in" && tableIds.length === 0;

  function submit() {
    setError(null);
    startTransition(async () => {
      const lines = toOrderLines(cart.cart);
      if (mode.kind === "new") {
        const res = await createStaffOrder({
          restaurantId: mode.restaurantId,
          tableIds,
          serviceType,
          guestLabel,
          note,
          lines,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        cart.clear();
        router.push(`/waiter/orders/${res.data.code}`);
      } else {
        const res = await setStaffOrderItems({ orderId: mode.orderId, code: mode.code, lines });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        cart.clear();
        router.push(`/waiter/orders/${mode.code}`);
      }
    });
  }

  return (
    <div className="space-y-4 pb-32">
      {/* Search + category chips */}
      <div className="sticky top-14 z-20 -mx-4 space-y-2 bg-neutral-50/95 px-4 py-2 backdrop-blur dark:bg-neutral-950/95">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search dishes…"
            aria-label="Search dishes"
            className="w-full rounded-2xl border border-neutral-200 bg-white py-2.5 pl-9 pr-9 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/20 dark:border-neutral-700 dark:bg-neutral-900"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          <Chip on={activeCategory === null} onClick={() => setActiveCategory(null)}>All</Chip>
          {categories.map((c) => (
            <Chip key={c.id} on={activeCategory === c.id} onClick={() => setActiveCategory(c.id)}>
              {c.name}
            </Chip>
          ))}
        </div>
      </div>

      {/* Dish list */}
      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">Nothing matches.</p>
      ) : (
        shown.map((c) => (
          <section key={c.id}>
            <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-neutral-500">{c.name}</h2>
            <ul className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
              {c.dishes.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{d.name}</p>
                    <p translate="no" className="text-xs text-neutral-500">{d.priceLabel}</p>
                  </div>
                  <AddToOrderButton dish={d} currency={ordering.currency} locale={ordering.locale} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {/* Running order */}
      <section className="rounded-3xl border border-brand-200 bg-white dark:border-brand-900/60 dark:bg-neutral-900">
        <h2 className="border-b border-neutral-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
          This order · {cart.count} {cart.count === 1 ? "item" : "items"}
        </h2>
        {cart.cart.lines.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-neutral-500">Tap Add on a dish to start.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {cart.cart.lines.map((line) => (
              <li key={line.key} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{line.name}</p>
                  {line.optionSummary || line.note ? (
                    <p className="truncate text-xs text-neutral-500">
                      {[line.optionSummary, line.note ? `“${line.note}”` : null].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </div>
                <span translate="no" className="text-sm font-semibold tabular-nums">{price(line.unitPriceCents * line.quantity)}</span>
                <QtyStepper size="sm" value={line.quantity} onChange={(qn) => cart.setQty(line.key, qn)} removable label={line.name} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {mode.kind === "new" ? (
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
            <TablePicker tables={tables} occupied={occupied} value={tableIds} onChange={setTableIds} />
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
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Note for the kitchen (optional)"
            aria-label="Order note"
            className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/20 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center px-4 pb-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending || cart.count === 0 || needsTable}
          className="pointer-events-auto flex w-full max-w-lg items-center justify-between rounded-full bg-green-600 px-6 py-4 text-white shadow-2xl shadow-black/30 transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="inline-flex items-center gap-2 text-sm font-bold">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
            {mode.kind === "new"
              ? needsTable
                ? "Pick a table"
                : "Send to billing"
              : "Save changes"}
          </span>
          <span translate="no" className="text-sm font-bold tabular-nums">{price(cart.subtotalCents)}</span>
        </button>
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition",
        on
          ? "border-brand-500 bg-brand-600 text-white"
          : "border-neutral-200 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300",
      )}
    >
      {children}
    </button>
  );
}
