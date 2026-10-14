import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";

import { createPublicClient } from "@/lib/supabase/public";
import { loadMenuData, type MenuData } from "@/lib/menu-view";
import { normalizeRatings } from "@/lib/reviews";
import type { PublicRestaurant, Review, ReviewForm } from "@/types/db";

// What a guest's QR scan reads, cached in two layers so an owner's edit can
// clear exactly what it changed by the id the action already holds:
//
//   slug → restaurant     tag "restaurants"     settings, publish, plan
//   restaurant → menu     tag "menu:<id>"       dishes, categories, schedules,
//                                               specials, reviews, import
//
// Sixty seconds is the fallback for what no action announces: a trial or
// paid term ending, which restaurants_public computes as it is read.

export const RESTAURANTS_TAG = "restaurants";
export const menuTag = (restaurantId: string) => `menu:${restaurantId}`;
export const PUBLIC_CACHE_SECONDS = 60;

// Only comments make sense as "floating words", and only so many fit before
// the loop gets tediously long.
const MAX_FLOATING_REVIEWS = 20;

export type PublicMenuExtras = MenuData & {
  /** Approved reviews with something to say, for the floating strip. */
  reviews: Review[];
};

async function loadPublicRestaurant(slug: string): Promise<PublicRestaurant | null> {
  const { data } = await createPublicClient()
    .from("restaurants_public")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<PublicRestaurant>();
  return data ?? null;
}

async function loadPublicMenu(restaurantId: string): Promise<PublicMenuExtras> {
  const supabase = createPublicClient();
  const [menu, formRes, reviewsRes] = await Promise.all([
    loadMenuData(supabase, restaurantId),
    supabase
      .from("review_forms")
      .select("show_on_menu")
      .eq("restaurant_id", restaurantId)
      .maybeSingle<Pick<ReviewForm, "show_on_menu">>(),
    // RLS already limits this to approved reviews on published restaurants.
    supabase
      .from("reviews")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .not("comment", "is", null)
      .order("created_at", { ascending: false })
      .limit(MAX_FLOATING_REVIEWS),
  ]);

  // No form row yet means the feature is on by default (see DEFAULT_REVIEW_SETTINGS).
  const showOnMenu = formRes.data?.show_on_menu ?? true;
  const reviews = showOnMenu
    ? ((reviewsRes.data as Review[] | null) ?? [])
        .map((r) => ({ ...r, ratings: normalizeRatings(r.ratings) }))
        // A comment of only whitespace would render as an empty bubble.
        .filter((r) => (r.comment ?? "").trim().length > 0)
    : [];

  return { ...menu, reviews };
}

/** The published restaurant behind a slug, or null. Cached. */
export function getPublicRestaurant(slug: string): Promise<PublicRestaurant | null> {
  return unstable_cache(() => loadPublicRestaurant(slug), ["public-restaurant", slug], {
    tags: [RESTAURANTS_TAG],
    revalidate: PUBLIC_CACHE_SECONDS,
  })();
}

/** Everything on the menu plus the floating reviews. Cached per restaurant. */
export function getPublicMenu(restaurantId: string): Promise<PublicMenuExtras> {
  return unstable_cache(() => loadPublicMenu(restaurantId), ["public-menu", restaurantId], {
    tags: [menuTag(restaurantId), RESTAURANTS_TAG],
    revalidate: PUBLIC_CACHE_SECONDS,
  })();
}

/** The review page's form, or null when there is none. Cached. */
export function getPublicReviewForm(restaurantId: string): Promise<ReviewForm | null> {
  return unstable_cache(
    async () => {
      const { data } = await createPublicClient()
        .from("review_forms")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .maybeSingle<ReviewForm>();
      return data ?? null;
    },
    ["public-review-form", restaurantId],
    { tags: [menuTag(restaurantId), RESTAURANTS_TAG], revalidate: PUBLIC_CACHE_SECONDS },
  )();
}

// --- Invalidation, called from the actions that change what a guest sees ---

// "max" is stale-while-revalidate, the form Next recommends: the action that
// made the change reads its own write at once, and a guest arriving in the
// same instant may get the previous menu one more time while the fresh one
// is fetched behind it. For a menu that is the right trade.

/** A dish, category, schedule, special, review or import changed. */
export function invalidateMenu(restaurantId: string): void {
  revalidateTag(menuTag(restaurantId), "max");
}

/** A restaurant's own row changed: name, logo, languages, publish, switches, plan. */
export function invalidateRestaurants(): void {
  revalidateTag(RESTAURANTS_TAG, "max");
}
