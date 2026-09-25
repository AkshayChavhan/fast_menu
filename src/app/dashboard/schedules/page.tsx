import { requireCapability } from "../lib";
import { createClient } from "@/lib/supabase/server";
import type { Category, MenuSchedule } from "@/types/db";
import { SchedulesManager } from "@/components/dashboard/schedules/SchedulesManager";

export const metadata = {
  title: "Schedules — fast_menu",
};

export default async function SchedulesPage() {
  const { restaurant } = await requireCapability("menu:manage");
  const supabase = await createClient();

  const [schedulesRes, categoriesRes] = await Promise.all([
    supabase
      .from("menu_schedules")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .order("starts_at", { ascending: true }),
    supabase
      .from("categories")
      .select("id, name, schedule_id")
      .eq("restaurant_id", restaurant.id)
      .order("sort_order", { ascending: true }),
  ]);

  const schedules = (schedulesRes.data as MenuSchedule[] | null) ?? [];
  const categories =
    (categoriesRes.data as Pick<Category, "id" | "name" | "schedule_id">[] | null) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Schedules</h1>
        <p className="text-sm text-neutral-500">
          Weekly windows like Breakfast or Happy hour. Assign one to a category
          under Menu and it shows only while the window is open, in{" "}
          <span className="font-medium">{restaurant.timezone}</span> time.
        </p>
      </div>

      <SchedulesManager
        restaurantId={restaurant.id}
        schedules={schedules}
        categories={categories}
      />
    </div>
  );
}
