import { z } from "zod";

import { ALLERGENS, DIETARY_TAGS, SUPPORTED_LOCALES } from "@/lib/constants";
import type { Category, Dish } from "@/types/db";

// Ceilings that keep a hand-edited (or pasted-from-anywhere) file from turning
// into a multi-megabyte insert.
export const IMPORT_MAX_CATEGORIES = 100;
export const IMPORT_MAX_DISHES = 1000;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const ALLERGEN_SET = new Set<string>(ALLERGENS);
const DIETARY_SET = new Set<string>(DIETARY_TAGS);
const LOCALE_SET = new Set<string>(SUPPORTED_LOCALES.map((l) => l.code));

// --- File shape -------------------------------------------------------------
// Prices are written in major units (12.50, not 1250) because a human edits
// this file. They're converted to the integer cents the database stores.

const translationMap = z.record(z.string(), z.string().trim().max(400));

const dishSchema = z.object({
  name: z.string().trim().min(1, "A dish is missing a name").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  price: z
    .number({ invalid_type_error: "`price` must be a number, e.g. 12.50" })
    .min(0, "`price` cannot be negative")
    .max(1_000_000)
    .optional()
    .default(0),
  image_url: z.string().trim().url("`image_url` must be a full URL").optional().nullable(),
  allergens: z.array(z.string().trim()).max(40).optional().default([]),
  dietary_tags: z.array(z.string().trim()).max(40).optional().default([]),
  available: z.boolean().optional().default(true),
  featured: z.boolean().optional().default(false),
  translations: z
    .object({
      name: translationMap.optional(),
      description: translationMap.optional(),
    })
    .optional(),
});

const categorySchema = z.object({
  name: z.string().trim().min(1, "A category is missing a name").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  translations: translationMap.optional(),
  dishes: z.array(dishSchema).max(IMPORT_MAX_DISHES).optional().default([]),
});

export const menuFileSchema = z.object({
  version: z.literal(1).optional().default(1),
  categories: z.array(categorySchema).max(IMPORT_MAX_CATEGORIES).optional().default([]),
  // Dishes that belong to no category. The public menu shows these under "More".
  dishes: z.array(dishSchema).max(IMPORT_MAX_DISHES).optional().default([]),
});

export type MenuFile = z.input<typeof menuFileSchema>;

// --- Normalised payload handed to the import_menu() SQL function ------------

export interface NormalizedDish {
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
}

export interface NormalizedCategory {
  name: string;
  name_i18n: Record<string, string>;
  description: string | null;
  dishes: NormalizedDish[];
}

export interface NormalizedMenu {
  categories: NormalizedCategory[];
  dishes: NormalizedDish[];
}

export interface ParsedMenu {
  menu: NormalizedMenu;
  /** Non-fatal problems: things silently dropped, worth showing before applying. */
  warnings: string[];
  counts: { categories: number; dishes: number };
}

export type ParseResult =
  | { ok: true; parsed: ParsedMenu }
  | { ok: false; error: string };

// Keep only vocabulary the app knows about; anything else is reported and
// dropped rather than failing the whole import over one typo.
function filterVocabulary(
  values: string[],
  allowed: Set<string>,
  label: string,
  dishName: string,
  warnings: string[],
): string[] {
  const kept: string[] = [];
  for (const raw of values) {
    const value = raw.toLowerCase();
    if (allowed.has(value)) {
      if (!kept.includes(value)) kept.push(value);
    } else {
      warnings.push(`"${dishName}": ignored unknown ${label} "${raw}"`);
    }
  }
  return kept;
}

function filterLocales(
  map: Record<string, string> | undefined,
  offered: Set<string>,
  what: string,
  warnings: string[],
): Record<string, string> {
  if (!map) return {};
  const out: Record<string, string> = {};
  for (const [locale, text] of Object.entries(map)) {
    if (!LOCALE_SET.has(locale)) {
      warnings.push(`${what}: ignored unsupported language "${locale}"`);
      continue;
    }
    if (!offered.has(locale)) {
      warnings.push(
        `${what}: ignored "${locale}" — add it to your menu languages in Settings first`,
      );
      continue;
    }
    if (text.trim()) out[locale] = text.trim();
  }
  return out;
}

function normalizeDish(
  dish: z.output<typeof dishSchema>,
  offered: Set<string>,
  warnings: string[],
): NormalizedDish {
  return {
    name: dish.name,
    name_i18n: filterLocales(
      dish.translations?.name,
      offered,
      `"${dish.name}" name translation`,
      warnings,
    ),
    description: dish.description?.trim() ? dish.description.trim() : null,
    description_i18n: filterLocales(
      dish.translations?.description,
      offered,
      `"${dish.name}" description translation`,
      warnings,
    ),
    // Round rather than truncate so 12.345 becomes 1235, not 1234.
    price_cents: Math.round(dish.price * 100),
    image_url: dish.image_url?.trim() ? dish.image_url.trim() : null,
    allergens: filterVocabulary(
      dish.allergens,
      ALLERGEN_SET,
      "allergen",
      dish.name,
      warnings,
    ),
    dietary_tags: filterVocabulary(
      dish.dietary_tags,
      DIETARY_SET,
      "dietary tag",
      dish.name,
      warnings,
    ),
    is_available: dish.available,
    is_featured: dish.featured,
  };
}

// Parse and normalise a menu file. `offeredLocales` comes from the restaurant,
// so a translation for a language the menu doesn't offer is reported instead of
// being written where nothing would ever read it.
export function parseMenuFile(
  raw: unknown,
  offeredLocales: string[],
): ParseResult {
  const result = menuFileSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".");
    return {
      ok: false,
      error: path
        ? `${path}: ${issue?.message ?? "invalid"}`
        : (issue?.message ?? "The file isn't a valid menu document"),
    };
  }

  const offered = new Set(offeredLocales);
  const warnings: string[] = [];

  const categories = result.data.categories.map((cat) => ({
    name: cat.name,
    name_i18n: filterLocales(
      cat.translations,
      offered,
      `category "${cat.name}"`,
      warnings,
    ),
    description: cat.description?.trim() ? cat.description.trim() : null,
    dishes: cat.dishes.map((d) => normalizeDish(d, offered, warnings)),
  }));

  const loose = result.data.dishes.map((d) => normalizeDish(d, offered, warnings));

  const dishCount =
    categories.reduce((n, c) => n + c.dishes.length, 0) + loose.length;

  if (dishCount > IMPORT_MAX_DISHES) {
    return {
      ok: false,
      error: `That's ${dishCount} dishes — the limit is ${IMPORT_MAX_DISHES} per import.`,
    };
  }

  if (categories.length === 0 && loose.length === 0) {
    return {
      ok: false,
      error:
        "The file has no categories or dishes. Importing it would empty your menu.",
    };
  }

  return {
    ok: true,
    parsed: {
      menu: { categories, dishes: loose },
      warnings,
      counts: { categories: categories.length, dishes: dishCount },
    },
  };
}

// --- Export -----------------------------------------------------------------

function toFileDish(dish: Dish): Record<string, unknown> {
  return {
    name: dish.name,
    description: dish.description ?? "",
    price: dish.price_cents / 100,
    image_url: dish.image_url ?? null,
    allergens: dish.allergens,
    dietary_tags: dish.dietary_tags,
    available: dish.is_available,
    featured: dish.is_featured,
    translations: {
      name: dish.name_i18n ?? {},
      description: dish.description_i18n ?? {},
    },
  };
}

// Serialise the live menu back into the import format, so "download, edit,
// re-upload" is a lossless round-trip and doubles as a backup before a
// destructive import.
export function serializeMenu(
  categories: Category[],
  dishes: Dish[],
): Record<string, unknown> {
  const byCategory = new Map<string, Dish[]>();
  const loose: Dish[] = [];
  const knownIds = new Set(categories.map((c) => c.id));

  for (const dish of dishes) {
    if (dish.category_id && knownIds.has(dish.category_id)) {
      const list = byCategory.get(dish.category_id);
      if (list) list.push(dish);
      else byCategory.set(dish.category_id, [dish]);
    } else {
      loose.push(dish);
    }
  }

  return {
    version: 1,
    categories: categories.map((cat) => ({
      name: cat.name,
      description: cat.description ?? "",
      translations: cat.name_i18n ?? {},
      dishes: (byCategory.get(cat.id) ?? []).map(toFileDish),
    })),
    dishes: loose.map(toFileDish),
  };
}

// A worked example for restaurants with nothing to export yet. The `_readme`
// key documents the format in the file itself; the parser ignores unknown keys.
export function sampleMenuFile(currency: string): Record<string, unknown> {
  return {
    _readme: [
      "Edit this file and upload it under Dashboard > Import.",
      "Importing REPLACES your whole menu — anything not in this file is deleted.",
      `"price" is in ${currency}, written in major units: 12.5 means 12.50.`,
      "Every field except \"name\" is optional.",
      "\"allergens\" must come from: " + ALLERGENS.join(", "),
      "\"dietary_tags\" must come from: " + DIETARY_TAGS.join(", "),
      "\"translations\" keys are language codes you have enabled in Settings.",
      "Use the top-level \"dishes\" array for items with no category.",
    ],
    version: 1,
    categories: [
      {
        name: "Starters",
        description: "Small plates to begin",
        translations: { hi: "स्टार्टर" },
        dishes: [
          {
            name: "Paneer Tikka",
            description: "Char-grilled cottage cheese, mint chutney",
            price: 320,
            image_url: null,
            allergens: ["dairy"],
            dietary_tags: ["vegetarian"],
            available: true,
            featured: true,
            translations: {
              name: { hi: "पनीर टिक्का" },
              description: { hi: "तंदूर में पका पनीर, पुदीने की चटनी" },
            },
          },
          {
            name: "Chicken 65",
            description: "Crisp fried chicken, curry leaf, red chilli",
            price: 380,
            allergens: ["gluten"],
            dietary_tags: ["spicy"],
          },
        ],
      },
      {
        name: "Mains",
        dishes: [
          {
            name: "Dal Makhani",
            description: "Black lentils simmered overnight",
            price: 340,
            allergens: ["dairy"],
            dietary_tags: ["vegetarian", "chef-special"],
          },
        ],
      },
    ],
    dishes: [
      {
        name: "Masala Chai",
        description: "Not filed under a category",
        price: 90,
        dietary_tags: ["vegetarian"],
      },
    ],
  };
}
