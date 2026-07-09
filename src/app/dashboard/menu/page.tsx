import { getActiveContext } from "../lib";
import { createClient } from "@/lib/supabase/server";
import type { Category, Dish } from "@/types/db";
import { MenuEditor } from "@/components/dashboard/menu/MenuEditor";

export default async function MenuPage() {
  const { restaurant } = await getActiveContext();
  const supabase = await createClient();

  const [categoriesRes, dishesRes] = await Promise.all([
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
  ]);

  const categories = (categoriesRes.data ?? []) as Category[];
  const dishes = (dishesRes.data ?? []) as Dish[];

  return (
    <MenuEditor
      restaurantId={restaurant.id}
      currency={restaurant.currency}
      defaultLocale={restaurant.default_locale}
      initialCategories={categories}
      initialDishes={dishes}
    />
  );
}
