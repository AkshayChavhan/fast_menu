import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UtensilsCrossed } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, localized } from "@/lib/utils";
import type {
  Restaurant,
  Category,
  Dish,
  DishPairing,
} from "@/types/db";
import { MenuHeader } from "@/components/menu/MenuHeader";
import { MenuHero } from "@/components/menu/MenuHero";
import { MenuBrowser } from "@/components/menu/MenuBrowser";
import type {
  CategoryView,
  DishView,
  PairingView,
} from "@/components/menu/types";

// Public menus change when the owner edits/publishes; keep them fresh but cheap.
export const revalidate = 60;

// 86'd dishes are hidden by default. Flip to false to show them dimmed.
const HIDE_UNAVAILABLE = true;

type LoadedMenu = {
  restaurant: Restaurant;
  categories: Category[];
  dishes: Dish[];
  pairings: DishPairing[];
};

// ---------------------------------------------------------------------------
// Data loading — SERVER anon client. RLS returns the restaurant (and its child
// rows) only when is_published = true, so an unpublished slug reads as absent.
// ---------------------------------------------------------------------------
async function loadMenu(slug: string): Promise<LoadedMenu | null> {
  const supabase = await createClient();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Restaurant>();

  if (!restaurant) return null;

  const [categoriesRes, dishesRes, pairingsRes] = await Promise.all([
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
    supabase
      .from("dish_pairings")
      .select("*")
      .eq("restaurant_id", restaurant.id),
  ]);

  return {
    restaurant,
    categories: (categoriesRes.data as Category[] | null) ?? [],
    dishes: (dishesRes.data as Dish[] | null) ?? [],
    pairings: (pairingsRes.data as DishPairing[] | null) ?? [],
  };
}

// Resolve the active locale from ?lang=, constrained to the restaurant's
// offered locales, falling back to its default_locale.
function resolveLocale(
  restaurant: Restaurant,
  requested: string | undefined,
): string {
  if (requested && restaurant.locales.includes(requested)) return requested;
  return restaurant.default_locale;
}

// ---------------------------------------------------------------------------
// View-model assembly — localize strings, format prices, resolve pairings.
// ---------------------------------------------------------------------------
function buildView(
  menu: LoadedMenu,
  locale: string,
): { categories: CategoryView[]; anyDishes: boolean } {
  const { restaurant, categories, dishes, pairings } = menu;

  const dishById = new Map(dishes.map((d) => [d.id, d]));

  const priceLabel = (cents: number) =>
    formatPrice(cents, restaurant.currency, locale);

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
    const description = localized(
      dish.description ?? "",
      dish.description_i18n,
      locale,
    );
    return {
      id: dish.id,
      name,
      description: description || null,
      priceLabel: priceLabel(dish.price_cents),
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
  for (const cat of categories) {
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
  const knownCategoryIds = new Set(categories.map((c) => c.id));
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

  return {
    categories: categoryViews,
    anyDishes: dishes.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const menu = await loadMenu(slug);

  if (!menu) {
    return {
      title: "Menu not found",
      robots: { index: false, follow: false },
    };
  }

  const { restaurant } = menu;
  const locale = restaurant.default_locale;
  const title = restaurant.name;
  const description =
    restaurant.description ??
    `View the menu at ${restaurant.name}. Browse dishes, allergens & more.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      locale,
      images: restaurant.logo_url ? [{ url: restaurant.logo_url }] : undefined,
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: restaurant.logo_url ? [restaurant.logo_url] : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function PublicMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { slug } = await params;
  const { lang } = await searchParams;

  const menu = await loadMenu(slug);
  if (!menu) notFound();

  const { restaurant } = menu;
  const locale = resolveLocale(restaurant, lang);

  const name = restaurant.name;
  const description = restaurant.description;

  const { categories, anyDishes } = buildView(menu, locale);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <MenuHeader
        name={name}
        logoUrl={restaurant.logo_url}
        locales={restaurant.locales}
        activeLocale={locale}
      />

      <MenuHero name={name} description={description} logoUrl={restaurant.logo_url} />

      {anyDishes ? (
        <MenuBrowser categories={categories} hideUnavailable={HIDE_UNAVAILABLE} />
      ) : (
        <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-950/50">
            <UtensilsCrossed className="h-8 w-8" aria-hidden />
          </div>
          <h2 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">
            The menu is being prepared
          </h2>
          <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
            {name} hasn’t added any dishes yet. Please check back soon!
          </p>
        </div>
      )}

      <footer className="border-t border-neutral-200/70 py-8 text-center dark:border-neutral-800/70">
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          {name} · Digital menu powered by{" "}
          <span className="font-semibold text-brand-500">fast_menu</span>
        </p>
      </footer>
    </div>
  );
}
