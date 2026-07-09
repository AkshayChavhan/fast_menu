// View-model shapes for the public menu. The server component resolves i18n,
// pairings and formatting into these plain, client-serializable objects so the
// interactive browser (search/filter) and the card components stay dumb & fast.

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
  priceLabel: string;
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
