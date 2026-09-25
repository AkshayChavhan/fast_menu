// Loads a restaurant's menu and turns it into the plain, client-serialisable
// view model the public menu and the waiter's order composer both render.
// Schedules, specials, variants and localisation are all resolved here so
// the components stay dumb.

import type { createClient } from "@/lib/supabase/server";
import { formatPrice, localized } from "@/lib/utils";
import { dishPriceRange, groupModifiersByDish, needsChoice } from "@/lib/modifiers";
import { isScheduleOpen, isSpecial, isSpecialActive, localClock } from "@/lib/schedule";
import type {
  Category,
  Dish,
  DishPairing,
  MenuSchedule,
  ModifierGroup,
  ModifierOption,
  Restaurant,
} from "@/types/db";
import type { CategoryView, DishView, PairingView } from "@/components/menu/types";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface MenuData {
  categories: Category[];
  dishes: Dish[];
  pairings: DishPairing[];
  modifierGroups: ModifierGroup[];
  modifierOptions: ModifierOption[];
  schedules: MenuSchedule[];
}

// Six reads in parallel. Which rows come back is up to RLS: the public sees a
// published restaurant's menu, staff see their own restaurant's.
export async function loadMenuData(supabase: Db, restaurantId: string): Promise<MenuData> {
  const [categoriesRes, dishesRes, pairingsRes, groupsRes, optionsRes, schedulesRes] =
    await Promise.all([
      supabase
        .from("categories")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("dishes")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase.from("dish_pairings").select("*").eq("restaurant_id", restaurantId),
      supabase.from("modifier_groups").select("*").eq("restaurant_id", restaurantId),
      supabase.from("modifier_options").select("*").eq("restaurant_id", restaurantId),
      supabase.from("menu_schedules").select("*").eq("restaurant_id", restaurantId),
    ]);

  return {
    categories: (categoriesRes.data as Category[] | null) ?? [],
    dishes: (dishesRes.data as Dish[] | null) ?? [],
    pairings: (pairingsRes.data as DishPairing[] | null) ?? [],
    modifierGroups: (groupsRes.data as ModifierGroup[] | null) ?? [],
    modifierOptions: (optionsRes.data as ModifierOption[] | null) ?? [],
    schedules: (schedulesRes.data as MenuSchedule[] | null) ?? [],
  };
}

export interface MenuView {
  categories: CategoryView[];
  anyDishes: boolean;
}

// Localise strings, format prices, resolve pairings, apply schedules and
// special windows by the restaurant's own clock.
export function buildMenuView(
  restaurant: Pick<Restaurant, "currency" | "timezone">,
  menu: MenuData,
  locale: string,
  now: Date = new Date(),
): MenuView {
  const { categories, pairings } = menu;

  // What is on right now: categories outside their schedule and specials
  // outside their dates are left off entirely.
  const clock = localClock(now, restaurant.timezone);
  const scheduleById = new Map(menu.schedules.map((s) => [s.id, s]));
  const openCategories = categories.filter((cat) =>
    isScheduleOpen(cat.schedule_id ? (scheduleById.get(cat.schedule_id) ?? null) : null, clock),
  );
  const closedCategoryIds = new Set(
    categories.filter((c) => !openCategories.includes(c)).map((c) => c.id),
  );
  const dishes = menu.dishes.filter(
    (d) =>
      isSpecialActive(d, clock.date) &&
      !(d.category_id && closedCategoryIds.has(d.category_id)),
  );

  const dishById = new Map(dishes.map((d) => [d.id, d]));
  const modifiersByDish = groupModifiersByDish(menu.modifierGroups, menu.modifierOptions);

  const priceLabel = (cents: number) => formatPrice(cents, restaurant.currency, locale);

  // Group pairings by source dish, resolving the paired dish's display data.
  const pairingsByDish = new Map<string, PairingView[]>();
  for (const p of pairings) {
    const paired = dishById.get(p.paired_dish_id);
    if (!paired) continue;
    // Don't upsell something that's currently 86'd.
    if (!paired.is_available) continue;
    const view: PairingView = {
      id: p.id,
      name: localized(paired.name, paired.name_i18n, locale),
      imageUrl: paired.image_url,
      priceLabel: priceLabel(paired.price_cents),
      kind: p.kind,
    };
    const list = pairingsByDish.get(p.dish_id);
    if (list) list.push(view);
    else pairingsByDish.set(p.dish_id, [view]);
  }

  const toDishView = (dish: Dish): DishView => {
    const name = localized(dish.name, dish.name_i18n, locale);
    const description = localized(dish.description ?? "", dish.description_i18n, locale);
    const groups = modifiersByDish.get(dish.id) ?? [];
    const range = dishPriceRange(dish, groups);
    return {
      id: dish.id,
      name,
      description: description || null,
      // Sizes priced differently read as "from <lowest>".
      priceLabel: range.from === range.to ? priceLabel(range.from) : `from ${priceLabel(range.from)}`,
      priceCents: dish.price_cents,
      hasChoices: needsChoice(groups),
      modifierGroups: groups,
      imageUrl: dish.image_url,
      allergens: dish.allergens,
      dietaryTags: dish.dietary_tags,
      isAvailable: dish.is_available,
      isFeatured: dish.is_featured || dish.dietary_tags.includes("chef-special"),
      isChefSpecial: dish.dietary_tags.includes("chef-special"),
      searchText: `${name} ${description}`.toLowerCase(),
      pairings: pairingsByDish.get(dish.id) ?? [],
    };
  };

  const dishesByCategory = new Map<string | null, Dish[]>();
  for (const dish of dishes) {
    const key = dish.category_id;
    const list = dishesByCategory.get(key);
    if (list) list.push(dish);
    else dishesByCategory.set(key, [dish]);
  }

  const categoryViews: CategoryView[] = [];

  // Specials first: every visible dish with a date window, in menu order.
  const specials = dishes.filter(isSpecial);
  if (specials.length > 0) {
    categoryViews.push({
      id: "__specials",
      name: "Today's specials",
      description: null,
      anchor: "cat-specials",
      dishes: specials.map(toDishView),
    });
  }

  for (const cat of openCategories) {
    const catDishes = dishesByCategory.get(cat.id) ?? [];
    if (catDishes.length === 0) continue;
    categoryViews.push({
      id: cat.id,
      name: localized(cat.name, cat.name_i18n, locale),
      description: cat.description,
      anchor: `cat-${cat.id}`,
      dishes: catDishes.map(toDishView),
    });
  }

  // Uncategorized dishes (category_id null, or pointing at a deleted category)
  // are surfaced under a friendly catch-all so nothing silently disappears.
  const knownCategoryIds = new Set(openCategories.map((c) => c.id));
  const orphans = dishes.filter(
    (d) => d.category_id === null || !knownCategoryIds.has(d.category_id),
  );
  if (orphans.length > 0) {
    categoryViews.push({
      id: "__uncategorized",
      name: "More",
      description: null,
      anchor: "cat-more",
      dishes: orphans.map(toDishView),
    });
  }

  return { categories: categoryViews, anyDishes: dishes.length > 0 };
}
