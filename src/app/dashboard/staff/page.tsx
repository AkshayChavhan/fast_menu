import { requireCapability } from "../lib";
import { createClient } from "@/lib/supabase/server";
import type { RestaurantStaff } from "@/types/db";
import { StaffManager } from "@/components/dashboard/staff/StaffManager";

export const metadata = {
  title: "Staff — fast_menu",
};

export default async function StaffPage() {
  const { restaurant, role } = await requireCapability("staff:manage");
  const supabase = await createClient();

  const { data } = await supabase
    .from("restaurant_staff")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .order("created_at", { ascending: true });

  const staff = (data as RestaurantStaff[] | null) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Staff</h1>
        <p className="text-sm text-neutral-500">
          Logins for the people who work at {restaurant.name}. Waiters and
          kitchen staff get their own phone and tablet apps; managers and
          cashiers use this dashboard.
        </p>
      </div>

      <StaffManager
        restaurantId={restaurant.id}
        actorRole={role}
        staff={staff}
      />
    </div>
  );
}
