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

// --- Reviews ---------------------------------------------------------------

export type ReviewStatus = "pending" | "approved" | "hidden";

// One star-rated prompt on the review form. `id` is generated in the browser
// when the owner adds the question and never changes, so submitted reviews
// stay linked to it even after the wording is edited.
export interface ReviewQuestion {
  id: string;
  prompt: string;
}

export interface ReviewForm {
  id: string;
  restaurant_id: string;
  is_enabled: boolean;
  headline: string;
  intro: string | null;
  questions: ReviewQuestion[];
  ask_name: boolean;
  ask_comment: boolean;
  comment_label: string;
  thank_you_message: string;
  show_on_menu: boolean;
  created_at: string;
  updated_at: string;
}

// A guest's answer to one prompt. `prompt` is snapshotted at submit time.
export interface ReviewRating {
  question_id: string;
  prompt: string;
  rating: number;
}

export interface Review {
  id: string;
  restaurant_id: string;
  guest_name: string | null;
  comment: string | null;
  ratings: ReviewRating[];
  overall_rating: number | null;
  status: ReviewStatus;
  created_at: string;
}

// The settings half of a review form, without the DB-managed columns. Used as
// the shape the dashboard edits and the defaults used before a row exists.
export type ReviewFormSettings = Pick<
  ReviewForm,
  | "is_enabled"
  | "headline"
  | "intro"
  | "questions"
  | "ask_name"
  | "ask_comment"
  | "comment_label"
  | "thank_you_message"
  | "show_on_menu"
>;
