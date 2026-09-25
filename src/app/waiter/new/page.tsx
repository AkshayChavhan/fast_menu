import { PowerOff } from "lucide-react";

import { requireContext } from "@/lib/membership";
import { createClient } from "@/lib/supabase/server";
import { buildMenuView, loadMenuData } from "@/lib/menu-view";
import { loadOccupiedTables, loadTables } from "@/app/waiter/data";
import type { OrderingInfo } from "@/components/menu/types";
import { CartProvider } from "@/components/ordering/CartProvider";
import { OrderComposer } from "@/components/waiter/OrderComposer";

export const dynamic = "force-dynamic";

// A waiter takes an order at the table: pick dishes, pick the table (or
// parcel), send it straight to billing.
export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ tables?: string }>;
}) {
  const { restaurant } = await requireContext("orders:serve");
  // "Add an order" from a bill preselects that bill's tables.
  const { tables: preselect } = await searchParams;
  const initialTableIds = (preselect ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));

  if (!restaurant.ordering_enabled) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-300 px-6 py-14 text-center dark:border-neutral-700">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-950/50">
          <PowerOff className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-base font-semibold">Table ordering is switched off</h1>
        <p className="mx-auto mt-1 max-w-xs text-sm text-neutral-500">
          Ask the owner to turn it on in Settings.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const [menu, tables, occupiedMap] = await Promise.all([
    loadMenuData(supabase, restaurant.id),
    loadTables(restaurant.id),
    loadOccupiedTables(restaurant.id),
  ]);
  const { categories } = buildMenuView(restaurant, menu, restaurant.default_locale);
  const occupied = Object.fromEntries(Array.from(occupiedMap, ([id, info]) => [id, info.label]));

  const ordering: OrderingInfo = {
    enabled: true,
    paused: false,
    pauseMessage: null,
    allowTakeaway: true,
    slug: restaurant.slug,
    currency: restaurant.currency,
    locale: restaurant.default_locale,
    table: null,
  };

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">New order</h1>
      <CartProvider slug={`staff-new:${restaurant.id}`}>
        <OrderComposer
          mode={{ kind: "new", restaurantId: restaurant.id }}
          cartSlug={`staff-new:${restaurant.id}`}
          categories={categories}
          ordering={ordering}
          tables={tables}
          occupied={occupied}
          initialTableIds={initialTableIds.filter((id) => tables.some((t) => t.id === id))}
        />
      </CartProvider>
    </div>
  );
}
