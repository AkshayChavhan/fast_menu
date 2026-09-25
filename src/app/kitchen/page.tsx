import { PowerOff } from "lucide-react";

import { requireContext } from "@/lib/membership";
import { loadTickets } from "./data";
import { KitchenBoard } from "@/components/kitchen/KitchenBoard";

// Live tickets: never cached, refreshed by Realtime and a slow poll.
export const dynamic = "force-dynamic";

export default async function KitchenPage() {
  const { restaurant } = await requireContext("kitchen:view");

  if (!restaurant.kds_enabled) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-neutral-700 px-8 py-16 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-950/60 text-brand-400">
          <PowerOff className="h-8 w-8" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold">The kitchen screen is switched off</h1>
        <p className="mt-2 text-base text-neutral-400">
          A manager can turn it on in Settings. Until then, orders go straight from the waiter to billing.
        </p>
      </div>
    );
  }

  const tickets = await loadTickets(restaurant.id);

  return (
    <KitchenBoard restaurantId={restaurant.id} tickets={tickets} timezone={restaurant.timezone} />
  );
}
