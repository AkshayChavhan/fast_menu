import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireContext } from "@/lib/membership";
import { createClient } from "@/lib/supabase/server";
import { buildMenuView, loadMenuData } from "@/lib/menu-view";
import { loadOrderByCode } from "@/app/waiter/data";
import type { OrderingInfo } from "@/components/menu/types";
import { CartProvider } from "@/components/ordering/CartProvider";
import { OrderComposer } from "@/components/waiter/OrderComposer";

export const dynamic = "force-dynamic";

// Change the lines of a placed or approved order. The composer starts from
// the order's current lines and replaces them as a whole on save.
export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { restaurant } = await requireContext("orders:serve");
  const { code } = await params;

  const order = await loadOrderByCode(restaurant.id, code);
  if (!order) notFound();
  if (order.status !== "placed" && order.status !== "approved") {
    redirect(`/waiter/orders/${order.code}`);
  }

  const supabase = await createClient();
  const menu = await loadMenuData(supabase, restaurant.id);
  const { categories } = buildMenuView(restaurant, menu, restaurant.default_locale);

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

  const initialLines = order.items
    .filter((i) => i.dish_id)
    .map((i) => ({
      dishId: i.dish_id as string,
      name: i.name,
      unitPriceCents: i.unit_price_cents,
      quantity: i.quantity,
      note: i.note,
      variantOptionId: i.variant?.option_id ?? null,
      addonOptionIds: i.addons.map((a) => a.option_id),
      optionSummary: [i.variant?.name, ...i.addons.map((a) => a.name)].filter(Boolean).join(" · "),
    }));

  const cartSlug = `staff-edit:${order.id}`;

  return (
    <div className="space-y-3">
      <Link
        href={`/waiter/orders/${order.code}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to {order.code}
      </Link>
      <h1 className="text-lg font-bold">Edit order {order.code}</h1>
      <CartProvider slug={cartSlug}>
        <OrderComposer
          mode={{ kind: "edit", orderId: order.id, code: order.code, initialLines }}
          cartSlug={cartSlug}
          categories={categories}
          ordering={ordering}
          tables={[]}
          occupied={{}}
        />
      </CartProvider>
    </div>
  );
}
