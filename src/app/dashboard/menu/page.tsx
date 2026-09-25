import { requireCapability } from "../lib";
import { createClient } from "@/lib/supabase/server";
import type { Category, Dish, MenuSchedule, ModifierGroup, ModifierOption } from "@/types/db";
import { MenuEditor } from "@/components/dashboard/menu/MenuEditor";

export default async function MenuPage() {
  const { restaurant } = await requireCapability("menu:manage");
  const supabase = await createClient();

  const [categoriesRes, dishesRes, groupsRes, optionsRes, schedulesRes] = await Promise.all([
    supabase
      .from("categories")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("dishes")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("modifier_groups")
      .select("*")
      .eq("restaurant_id", restaurant.id),
    supabase
      .from("modifier_options")
      .select("*")
      .eq("restaurant_id", restaurant.id),
    supabase
      .from("menu_schedules")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .order("starts_at", { ascending: true }),
  ]);

  const categories = (categoriesRes.data ?? []) as Category[];
  const dishes = (dishesRes.data ?? []) as Dish[];
  const modifierGroups = (groupsRes.data ?? []) as ModifierGroup[];
  const modifierOptions = (optionsRes.data ?? []) as ModifierOption[];
  const schedules = (schedulesRes.data ?? []) as MenuSchedule[];

  return (
    <MenuEditor
      restaurantId={restaurant.id}
      currency={restaurant.currency}
      defaultLocale={restaurant.default_locale}
      initialCategories={categories}
      initialDishes={dishes}
      initialModifierGroups={modifierGroups}
      initialModifierOptions={modifierOptions}
      schedules={schedules}
    />
  );
}
