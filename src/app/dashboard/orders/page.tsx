import { requireCapability } from "../lib";
import { can } from "@/lib/permissions";
import { loadBilling } from "./data";
import { BillingCounter } from "@/components/dashboard/orders/BillingCounter";

export const metadata = {
  title: "Orders & billing — fast_menu",
};

// Live: never cached, refreshed by Realtime and a slow poll.
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const { restaurant, role } = await requireCapability("billing:settle");
  const billing = await loadBilling(restaurant.id, restaurant.timezone);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Orders &amp; billing</h1>
        <p className="text-sm text-neutral-500">
          Every open bill, grouped by table, exactly as the waiters approved it.
          Mark a bill paid when the guests settle up.
        </p>
      </div>

      <BillingCounter
        restaurantId={restaurant.id}
        billing={billing}
        currency={restaurant.currency}
        locale={restaurant.default_locale}
        timezone={restaurant.timezone}
        canReopen={can(role, "menu:manage")}
        orderingEnabled={restaurant.ordering_enabled}
      />
    </div>
  );
}
