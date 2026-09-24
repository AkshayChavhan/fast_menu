import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireContext } from "@/lib/membership";
import { loadOccupiedTables, loadOrderByCode, loadTables } from "@/app/waiter/data";
import { OrderReview } from "@/components/waiter/OrderReview";

export const dynamic = "force-dynamic";

export default async function WaiterOrderPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { restaurant } = await requireContext("orders:serve");
  const { code } = await params;

  const [order, tables, occupiedMap] = await Promise.all([
    loadOrderByCode(restaurant.id, code),
    loadTables(restaurant.id),
    loadOccupiedTables(restaurant.id),
  ]);
  if (!order) notFound();

  // Tables on this order's own session aren't "taken" from its point of view.
  const occupied: Record<string, string> = {};
  for (const [tableId, info] of occupiedMap) {
    if (order.session_id && info.sessionId === order.session_id) continue;
    occupied[tableId] = info.label;
  }

  return (
    <div className="space-y-4">
      <Link
        href="/waiter"
        className="inline-flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Home
      </Link>
      <OrderReview
        order={order}
        tables={tables}
        occupied={occupied}
        currency={restaurant.currency}
        locale={restaurant.default_locale}
      />
    </div>
  );
}
