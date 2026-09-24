// Shared domain types mirroring supabase/migrations/.
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
  trial_ends_at: string;
  // Table-ordering switches (see migrations/20260924000100). All default off.
  timezone: string;
  ordering_enabled: boolean;
  ordering_paused: boolean;
  pause_message: string | null;
  table_qr_enabled: boolean;
  kds_enabled: boolean;
  allow_takeaway: boolean;
  google_review_url: string | null;
  // Trial identity (see migrations/*_trial_claims). Owners claim the trial
  // once with a verified phone; the dashboard is gated until it is active.
  phone: string | null;
  phone_verified_at: string | null;
  gstin: string | null;
  city: string | null;
  pincode: string | null;
  trial_status: TrialStatus;
  created_at: string;
  updated_at: string;
}

export type TrialStatus = "pending" | "active" | "needs_review" | "denied";

// --- Staff -----------------------------------------------------------------

// Everyone who works at a restaurant other than its owner. The owner is
// restaurants.owner_id and reads as role "owner" through member_role().
export const STAFF_ROLES = ["manager", "cashier", "waiter", "kitchen"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type MemberRole = "owner" | StaffRole;

export interface RestaurantStaff {
  id: string;
  restaurant_id: string;
  user_id: string;
  role: StaffRole;
  display_name: string | null;
  // Copy of the auth email, for the roster (see migrations/*_staff_email).
  email: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// --- Tables ----------------------------------------------------------------

// A physical table. `qr_token` is what the printed per-table QR encodes, so
// `label` can change without a reprint.
export interface RestaurantTable {
  id: string;
  restaurant_id: string;
  label: string;
  qr_token: string;
  capacity: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// --- Variants and add-ons -------------------------------------------------

export type ModifierKind = "variant" | "addon";

// A choice on a dish. variant: pick exactly one, its price replaces the dish
// price. addon: pick min..max, each price is added.
export interface ModifierGroup {
  id: string;
  restaurant_id: string;
  dish_id: string;
  name: string;
  name_i18n: Record<string, string>;
  kind: ModifierKind;
  min_select: number;
  max_select: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ModifierOption {
  id: string;
  restaurant_id: string;
  group_id: string;
  name: string;
  name_i18n: Record<string, string>;
  price_cents: number;
  is_available: boolean;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ModifierGroupWithOptions extends ModifierGroup {
  options: ModifierOption[];
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
