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

// A weekly window in the restaurant's timezone. Categories that point at one
// are shown (and orderable) only while it is open.
export interface MenuSchedule {
  id: string;
  restaurant_id: string;
  name: string;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** "HH:MM:SS" local time. May be later than ends_at for an overnight window. */
  starts_at: string;
  ends_at: string;
  is_active: boolean;
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
  /** Restrict this category to a schedule; null = always. */
  schedule_id: string | null;
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
  /** Daily special window (local dates, inclusive). Both null = ordinary dish. */
  special_from: string | null;
  special_until: string | null;
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

// --- Ordering ----------------------------------------------------------------

export type OrderStatus = "placed" | "approved" | "settled" | "rejected" | "cancelled";
export type OrderSource = "customer" | "waiter";
export type ServiceType = "dine_in" | "takeaway";
export type SessionStatus = "open" | "bill_requested" | "closed";
export type KdsStatus = "queued" | "preparing" | "ready" | "served";

// One seating: opened on the first approved order for a table (or when a
// waiter seats a walk-in), closed when billing marks it paid.
export interface TableSession {
  id: string;
  restaurant_id: string;
  status: SessionStatus;
  service_type: ServiceType;
  guest_label: string | null;
  opened_by: string | null;
  opened_at: string;
  bill_requested_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  /** Sum of approved and settled orders, kept by trigger. */
  total_cents: number;
  payment_method: string | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  restaurant_id: string;
  /** Six unambiguous characters, unique per restaurant. */
  code: string;
  status: OrderStatus;
  source: OrderSource;
  service_type: ServiceType;
  table_id: string | null;
  session_id: string | null;
  note: string | null;
  /** Sum of line totals, kept by trigger. */
  subtotal_cents: number;
  currency: string;
  locale: string | null;
  device_key: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  last_edited_by: string | null;
  last_edited_at: string | null;
  rejected_reason: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

// Snapshots taken when the line was written.
export interface OrderItemVariant {
  option_id: string;
  group: string;
  name: string;
  price_cents: number;
}

export interface OrderItemAddon {
  option_id: string;
  group_id: string;
  group: string;
  name: string;
  price_cents: number;
}

export interface OrderItem {
  id: string;
  order_id: string;
  restaurant_id: string;
  dish_id: string | null;
  name: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
  variant: OrderItemVariant | null;
  addons: OrderItemAddon[];
  note: string | null;
  kds_status: KdsStatus | null;
  sort_order: number;
  created_at: string;
}

export interface OrderEvent {
  id: string;
  order_id: string;
  restaurant_id: string;
  actor_id: string | null;
  kind: string;
  details: Record<string, unknown>;
  created_at: string;
}

export type ServiceRequestKind = "call_waiter" | "request_bill";

export interface ServiceRequest {
  id: string;
  restaurant_id: string;
  table_id: string | null;
  session_id: string | null;
  kind: ServiceRequestKind;
  status: "open" | "done";
  device_key: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

// What get_order_by_code() hands the guest's order page.
export interface PublicOrderItem {
  id: string;
  /** Null when the dish was deleted after the order was placed. */
  dish_id: string | null;
  name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  variant: OrderItemVariant | null;
  addons: OrderItemAddon[];
  note: string | null;
}

export interface PublicOrder {
  id: string;
  code: string;
  status: OrderStatus;
  service_type: ServiceType;
  table_label: string | null;
  note: string | null;
  subtotal_cents: number;
  currency: string;
  created_at: string;
  approved_at: string | null;
  expires_at: string;
  rejected_reason: string | null;
  session_status: SessionStatus | null;
  session_total_cents: number | null;
  items: PublicOrderItem[];
}

// One line as the guest (or waiter) submits it; the database re-prices it.
export interface OrderLineInput {
  dish_id: string;
  quantity: number;
  note: string | null;
  variant_option_id: string | null;
  addon_option_ids: string[];
}
