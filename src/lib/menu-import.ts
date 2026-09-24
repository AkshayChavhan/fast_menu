import { z } from "zod";

import { ALLERGENS, DIETARY_TAGS, SUPPORTED_LOCALES } from "@/lib/constants";
import type {
  Category,
  Dish,
  MenuSchedule,
  ModifierGroupWithOptions,
} from "@/types/db";

// Ceilings that keep a hand-edited (or pasted-from-anywhere) file from turning
// into a multi-megabyte insert.
export const IMPORT_MAX_CATEGORIES = 100;
export const IMPORT_MAX_DISHES = 1000;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const IMPORT_MAX_MODIFIER_GROUPS = 10;
export const IMPORT_MAX_MODIFIER_OPTIONS = 30;

const ALLERGEN_SET = new Set<string>(ALLERGENS);
const DIETARY_SET = new Set<string>(DIETARY_TAGS);
const LOCALE_SET = new Set<string>(SUPPORTED_LOCALES.map((l) => l.code));

// --- File shape -------------------------------------------------------------
// Prices are written in major units (12.50, not 1250) because a human edits
// this file. They're converted to the integer cents the database stores.

const translationMap = z.record(z.string(), z.string().trim().max(400));

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "dates are written YYYY-MM-DD");

const priceNumber = z
  .number({ invalid_type_error: "`price` must be a number, e.g. 12.50" })
  .min(0, "`price` cannot be negative")
  .max(1_000_000);

const modifierOptionSchema = z.object({
  name: z.string().trim().min(1, "An option is missing a name").max(80),
  price: priceNumber.optional().default(0),
  default: z.boolean().optional().default(false),
  available: z.boolean().optional().default(true),
});

const modifierGroupSchema = z.object({
  name: z.string().trim().min(1, "A modifier group is missing a name").max(80),
  kind: z.enum(["variant", "addon"], {
    errorMap: () => ({ message: '`kind` must be "variant" or "addon"' }),
  }),
  min: z.number().int().min(0).max(20).optional().default(0),
  max: z.number().int().min(1).max(20).optional().nullable().default(null),
  options: z.array(modifierOptionSchema).max(IMPORT_MAX_MODIFIER_OPTIONS).optional().default([]),
});

const dishSchema = z.object({
  name: z.string().trim().min(1, "A dish is missing a name").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  price: priceNumber.optional().default(0),
  image_url: z.string().trim().url("`image_url` must be a full URL").optional().nullable(),
  allergens: z.array(z.string().trim()).max(40).optional().default([]),
  dietary_tags: z.array(z.string().trim()).max(40).optional().default([]),
  available: z.boolean().optional().default(true),
  featured: z.boolean().optional().default(false),
  special_from: isoDate.optional().nullable(),
  special_until: isoDate.optional().nullable(),
  modifiers: z.array(modifierGroupSchema).max(IMPORT_MAX_MODIFIER_GROUPS).optional().default([]),
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
  // Name of one of the restaurant's schedules; resolved by the database.
  schedule: z.string().trim().max(60).optional().nullable(),
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

export interface NormalizedModifierOption {
  name: string;
  price_cents: number;
  is_default: boolean;
  is_available: boolean;
}

export interface NormalizedModifierGroup {
  name: string;
  kind: "variant" | "addon";
  min_select: number;
  max_select: number | null;
  options: NormalizedModifierOption[];
}

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
  special_from: string | null;
  special_until: string | null;
  modifiers: NormalizedModifierGroup[];
}

export interface NormalizedCategory {
  name: string;
  name_i18n: Record<string, string>;
  description: string | null;
  schedule: string | null;
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

// Round rather than truncate so 12.345 becomes 1235, not 1234.
const toCents = (major: number) => Math.round(major * 100);

function normalizeModifiers(
  groups: z.output<typeof modifierGroupSchema>[],
  dishName: string,
  warnings: string[],
): NormalizedModifierGroup[] {
  const out: NormalizedModifierGroup[] = [];
  for (const g of groups) {
    if (g.kind === "variant" && g.options.length === 0) {
      warnings.push(`"${dishName}": dropped variant group "${g.name}" because it has no options`);
      continue;
    }
    let max = g.kind === "variant" ? 1 : g.max;
    const min = g.kind === "variant" ? 1 : g.min;
    if (max !== null && max < min) {
      warnings.push(`"${dishName}": "${g.name}" had max below min; max was raised to ${min}`);
      max = min;
    }
    out.push({
      name: g.name,
      kind: g.kind,
      min_select: min,
      max_select: max,
      options: g.options.map((o) => ({
        name: o.name,
        price_cents: toCents(o.price),
        is_default: g.kind === "variant" && o.default,
        is_available: o.available,
      })),
    });
  }
  return out;
}

function normalizeDish(
  dish: z.output<typeof dishSchema>,
  offered: Set<string>,
  warnings: string[],
): NormalizedDish {
  let specialFrom = dish.special_from ?? null;
  let specialUntil = dish.special_until ?? null;
  if (specialFrom && specialUntil && specialFrom > specialUntil) {
    warnings.push(`"${dish.name}": special dates were reversed and have been ignored`);
    specialFrom = null;
    specialUntil = null;
  }

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
    price_cents: toCents(dish.price),
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
    special_from: specialFrom,
    special_until: specialUntil,
    modifiers: normalizeModifiers(dish.modifiers, dish.name, warnings),
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
    schedule: cat.schedule?.trim() ? cat.schedule.trim() : null,
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

function toFileModifiers(groups: ModifierGroupWithOptions[]): Record<string, unknown>[] {
  return groups.map((g) => ({
    name: g.name,
    kind: g.kind,
    min: g.min_select,
    max: g.max_select,
    options: g.options.map((o) => ({
      name: o.name,
      price: o.price_cents / 100,
      default: o.is_default,
      available: o.is_available,
    })),
  }));
}

function toFileDish(
  dish: Dish,
  modifiers: ModifierGroupWithOptions[],
): Record<string, unknown> {
  return {
    name: dish.name,
    description: dish.description ?? "",
    price: dish.price_cents / 100,
    image_url: dish.image_url ?? null,
    allergens: dish.allergens,
    dietary_tags: dish.dietary_tags,
    available: dish.is_available,
    featured: dish.is_featured,
    special_from: dish.special_from ?? null,
    special_until: dish.special_until ?? null,
    modifiers: toFileModifiers(modifiers),
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
  modifiersByDish: Map<string, ModifierGroupWithOptions[]> = new Map(),
  schedules: Pick<MenuSchedule, "id" | "name">[] = [],
): Record<string, unknown> {
  const byCategory = new Map<string, Dish[]>();
  const loose: Dish[] = [];
  const knownIds = new Set(categories.map((c) => c.id));
  const scheduleName = new Map(schedules.map((s) => [s.id, s.name]));

  for (const dish of dishes) {
    if (dish.category_id && knownIds.has(dish.category_id)) {
      const list = byCategory.get(dish.category_id);
      if (list) list.push(dish);
      else byCategory.set(dish.category_id, [dish]);
    } else {
      loose.push(dish);
    }
  }

  const fileDish = (d: Dish) => toFileDish(d, modifiersByDish.get(d.id) ?? []);

  return {
    version: 1,
    categories: categories.map((cat) => ({
      name: cat.name,
      description: cat.description ?? "",
      schedule: cat.schedule_id ? (scheduleName.get(cat.schedule_id) ?? null) : null,
      translations: cat.name_i18n ?? {},
      dishes: (byCategory.get(cat.id) ?? []).map(fileDish),
    })),
    dishes: loose.map(fileDish),
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
      "\"modifiers\" holds sizes (kind \"variant\": pick one, its price replaces the dish price) and add-ons (kind \"addon\": pick min..max, prices are added).",
      "\"special_from\" / \"special_until\" (YYYY-MM-DD) make a dish a daily special for those dates.",
      "A category's \"schedule\" names one of your schedules (Dashboard > Schedules); it must exist already.",
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
            modifiers: [
              {
                name: "Portion",
                kind: "variant",
                options: [
                  { name: "Half", price: 180, default: true },
                  { name: "Full", price: 320 },
                ],
              },
              {
                name: "Extras",
                kind: "addon",
                min: 0,
                max: 2,
                options: [
                  { name: "Extra chutney", price: 20 },
                  { name: "Cheese", price: 40 },
                ],
              },
            ],
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
          {
            name: "Monsoon Thali",
            description: "This week only",
            price: 450,
            special_from: "2026-09-21",
            special_until: "2026-09-27",
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
