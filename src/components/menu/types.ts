// View-model shapes for the public menu. The server component resolves i18n,
// pairings and formatting into these plain, client-serializable objects so the
// interactive browser (search/filter) and the card components stay dumb & fast.

import type { ModifierGroupWithOptions } from "@/types/db";

export interface PairingView {
  id: string;
  name: string;
  imageUrl: string | null;
  priceLabel: string;
  kind: "pairing" | "addon";
}

export interface DishView {
  id: string;
  name: string;
  description: string | null;
  /** Formatted price, or "from …" when sizes are priced differently. */
  priceLabel: string;
  /** Base price in minor units; variants may replace it. */
  priceCents: number;
  /** Whether the guest must or may pick something (sizes, add-ons). */
  hasChoices: boolean;
  /** Variants and add-ons, for the ordering sheet. */
  modifierGroups: ModifierGroupWithOptions[];
  imageUrl: string | null;
  allergens: string[];
  dietaryTags: string[];
  isAvailable: boolean;
  isFeatured: boolean;
  isChefSpecial: boolean;
  /** Lowercased haystack for client-side text search. */
  searchText: string;
  pairings: PairingView[];
}

export interface CategoryView {
  id: string;
  name: string;
  description: string | null;
  /** Anchor id used by the quick-nav and section scroll. */
  anchor: string;
  dishes: DishView[];
}

// Everything the ordering UI on the public menu needs from the restaurant.
// Null when the menu is read-only.
export interface OrderingInfo {
  enabled: boolean;
  paused: boolean;
  pauseMessage: string | null;
  allowTakeaway: boolean;
  slug: string;
  currency: string;
  locale: string;
  /** The table from a per-table QR code, when one was scanned. */
  table: { label: string; token: string } | null;
}
