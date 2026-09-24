import { requireCapability } from "../lib";
import { createClient } from "@/lib/supabase/server";
import { serializeMenu, sampleMenuFile } from "@/lib/menu-import";
import { groupModifiersByDish } from "@/lib/modifiers";
import type {
  Category,
  Dish,
  MenuSchedule,
  ModifierGroup,
  ModifierOption,
} from "@/types/db";
import { MenuImportPanel } from "@/components/dashboard/import/MenuImportPanel";
import { MenuExportCard } from "@/components/dashboard/import/MenuExportCard";

export const metadata = {
  title: "Import & export menu — fast_menu",
};

export default async function ImportPage() {
  const { restaurant } = await requireCapability("menu:import");
  const supabase = await createClient();

  const [categoriesRes, dishesRes, groupsRes, optionsRes, schedulesRes] =
    await Promise.all([
      supabase
        .from("categories")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("dishes")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase.from("modifier_groups").select("*").eq("restaurant_id", restaurant.id),
      supabase.from("modifier_options").select("*").eq("restaurant_id", restaurant.id),
      supabase.from("menu_schedules").select("id, name").eq("restaurant_id", restaurant.id),
    ]);

  const categories = (categoriesRes.data ?? []) as Category[];
  const dishes = (dishesRes.data ?? []) as Dish[];
  const modifiersByDish = groupModifiersByDish(
    (groupsRes.data ?? []) as ModifierGroup[],
    (optionsRes.data ?? []) as ModifierOption[],
  );
  const schedules = (schedulesRes.data ?? []) as Pick<MenuSchedule, "id" | "name">[];

  // Both files are built server-side and handed to the client as text, so the
  // download buttons are a Blob away and need no extra round-trip.
  const currentMenuJson = JSON.stringify(
    serializeMenu(categories, dishes, modifiersByDish, schedules),
    null,
    2,
  );
  const sampleJson = JSON.stringify(sampleMenuFile(restaurant.currency), null, 2);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import &amp; export</h1>
        <p className="text-sm text-neutral-500">
          Move your whole menu in and out as a single JSON file.
        </p>
      </div>

      <MenuExportCard
        slug={restaurant.slug}
        menuJson={currentMenuJson}
        counts={{ categories: categories.length, dishes: dishes.length }}
      />

      <MenuImportPanel
        restaurantId={restaurant.id}
        slug={restaurant.slug}
        currency={restaurant.currency}
        sampleJson={sampleJson}
      />
    </div>
  );
}
