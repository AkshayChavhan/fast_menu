// Shared domain types mirroring supabase/schema.sql.
// Kept hand-written (rather than generated) so the app has a single, stable
// contract that every feature imports.

export type PairingKind = "pairing" | "addon";

export interface Profile {
  id: string;
  full_name: string | null;
  created_at: string;
}

export interface Restaurant {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  currency: string;
  default_locale: string;
  locales: string[];
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  restaurant_id: string;
  name: string;
  name_i18n: Record<string, string>;
  description: string | null;
  sort_order: number;
  created_at: string;
}

export interface Dish {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  name_i18n: Record<string, string>;
  description: string | null;
  description_i18n: Record<string, string>;
  price_cents: number;
  image_url: string | null;
  allergens: string[];
  dietary_tags: string[];
  is_available: boolean;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DishPairing {
  id: string;
  restaurant_id: string;
  dish_id: string;
  paired_dish_id: string;
  kind: PairingKind;
  created_at: string;
}

// Convenience shape for rendering a full public menu.
export interface CategoryWithDishes extends Category {
  dishes: Dish[];
}

export interface PublicMenu {
  restaurant: Restaurant;
  categories: CategoryWithDishes[];
  pairings: DishPairing[];
}
