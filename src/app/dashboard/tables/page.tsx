import { requireCapability } from "../lib";
import { createClient } from "@/lib/supabase/server";
import { sortByLabel } from "@/lib/tables";
import type { RestaurantTable } from "@/types/db";
import { TablesManager } from "@/components/dashboard/tables/TablesManager";

export const metadata = {
  title: "Tables — fast_menu",
};

export default async function TablesPage() {
  const { restaurant } = await requireCapability("tables:manage");
  const supabase = await createClient();

  const { data } = await supabase
    .from("tables")
    .select("*")
    .eq("restaurant_id", restaurant.id);

  const tables = sortByLabel((data as RestaurantTable[] | null) ?? []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tables</h1>
        <p className="text-sm text-neutral-500">
          The tables waiters pick from and, with per-table QR codes on, the
          codes guests scan. Rename freely: printed codes keep working.
        </p>
      </div>

      <TablesManager
        restaurantId={restaurant.id}
        tables={tables}
        tableQrEnabled={restaurant.table_qr_enabled}
      />
    </div>
  );
}
