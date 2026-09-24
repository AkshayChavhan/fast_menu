import Link from "next/link";
import { ClipboardList, Plus, PowerOff, ScanLine } from "lucide-react";

import { requireContext } from "@/lib/membership";
import { loadWaiterHome } from "./data";
import { WaiterHome } from "@/components/waiter/WaiterHome";

// Live queues: never cached, refreshed by the client every few seconds.
export const dynamic = "force-dynamic";

export default async function WaiterHomePage() {
  const { restaurant } = await requireContext("orders:serve");

  if (!restaurant.ordering_enabled) {
    return (
      <Notice
        icon={<PowerOff className="h-6 w-6" aria-hidden />}
        title="Table ordering is switched off"
        body="Once the owner turns it on in Settings, orders waiting for approval will show up here."
      />
    );
  }

  const home = await loadWaiterHome(restaurant.id);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/waiter/scan"
          className="flex items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700"
        >
          <ScanLine className="h-5 w-5" aria-hidden /> Scan an order
        </Link>
        <Link
          href="/waiter/new"
          className="flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-sm font-bold text-neutral-800 transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          <Plus className="h-5 w-5" aria-hidden /> New order
        </Link>
      </div>

      {restaurant.ordering_paused ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Guest ordering is paused{restaurant.pause_message ? `: ${restaurant.pause_message}` : ""}. You can still take orders here.
        </p>
      ) : null}

      <WaiterHome
        restaurantId={restaurant.id}
        home={home}
        currency={restaurant.currency}
        locale={restaurant.default_locale}
      />

      {home.placed.length === 0 && home.sessions.length === 0 && home.requests.length === 0 ? (
        <Notice
          icon={<ClipboardList className="h-6 w-6" aria-hidden />}
          title="All quiet"
          body="Orders placed from the menu appear here as soon as guests send them."
        />
      ) : null}
    </div>
  );
}

function Notice({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 px-6 py-14 text-center dark:border-neutral-700">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-950/50">
        {icon}
      </div>
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="mx-auto mt-1 max-w-xs text-sm text-neutral-500">{body}</p>
    </div>
  );
}
