import { describe, it, expect } from "vitest";

import {
  parseMenuFile,
  serializeMenu,
  sampleMenuFile,
  IMPORT_MAX_DISHES,
} from "@/lib/menu-import";
import type { Category, Dish } from "@/types/db";

const LOCALES = ["en", "hi"];

// Minimal valid file, spread into to vary one thing at a time.
function fileWithDish(dish: Record<string, unknown>) {
  return { categories: [{ name: "C", dishes: [dish] }] };
}

function parseOrThrow(raw: unknown, locales = LOCALES) {
  const res = parseMenuFile(raw, locales);
  if (!res.ok) throw new Error(`expected parse to succeed: ${res.error}`);
  return res.parsed;
}

function firstDish(raw: unknown, locales = LOCALES) {
  return parseOrThrow(raw, locales).menu.categories[0].dishes[0];
}

describe("parseMenuFile", () => {
  describe("the shipped sample file", () => {
    const parsed = parseOrThrow(sampleMenuFile("INR"));

    it("parses with no warnings", () => {
      expect(parsed.warnings).toEqual([]);
    });

    it("counts categories and dishes, including uncategorized ones", () => {
      expect(parsed.counts).toEqual({ categories: 2, dishes: 4 });
      expect(parsed.menu.dishes).toHaveLength(1);
    });

    it("keeps the _readme key from breaking the parse", () => {
      // Unknown keys are stripped by zod rather than rejected, which is what
      // lets the sample document itself.
      expect(parsed.menu.categories[0].name).toBe("Starters");
    });
  });

  describe("prices", () => {
    it("converts major units to integer cents", () => {
      expect(firstDish(fileWithDish({ name: "D", price: 320 })).price_cents).toBe(
        32000,
      );
      expect(firstDish(fileWithDish({ name: "D", price: 12.5 })).price_cents).toBe(
        1250,
      );
    });

    it("rounds rather than truncating", () => {
      // 12.345 * 100 is 1234.4999… in binary floating point; truncating would
      // silently under-charge by a cent.
      expect(
        firstDish(fileWithDish({ name: "D", price: 12.345 })).price_cents,
      ).toBe(1235);
    });

    it("defaults a missing price to zero", () => {
      expect(firstDish(fileWithDish({ name: "D" })).price_cents).toBe(0);
    });

    it("rejects a non-numeric price", () => {
      const res = parseMenuFile(fileWithDish({ name: "D", price: "free" }), LOCALES);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/price/);
    });

    it("rejects a negative price", () => {
      expect(parseMenuFile(fileWithDish({ name: "D", price: -5 }), LOCALES).ok).toBe(
        false,
      );
    });
  });

  describe("controlled vocabularies", () => {
    it("keeps known allergens and dietary tags", () => {
      const dish = firstDish(
        fileWithDish({
          name: "D",
          allergens: ["dairy", "gluten"],
          dietary_tags: ["vegan"],
        }),
      );
      expect(dish.allergens).toEqual(["dairy", "gluten"]);
      expect(dish.dietary_tags).toEqual(["vegan"]);
    });

    it("drops unknown values with a warning instead of failing", () => {
      const parsed = parseOrThrow(
        fileWithDish({
          name: "Paneer",
          allergens: ["dairy", "moon-dust"],
          dietary_tags: ["bogus"],
        }),
      );
      const dish = parsed.menu.categories[0].dishes[0];
      expect(dish.allergens).toEqual(["dairy"]);
      expect(dish.dietary_tags).toEqual([]);
      expect(parsed.warnings).toHaveLength(2);
      expect(parsed.warnings[0]).toContain("moon-dust");
      expect(parsed.warnings[0]).toContain("Paneer");
    });

    it("is case-insensitive and de-duplicates", () => {
      const dish = firstDish(
        fileWithDish({ name: "D", allergens: ["DAIRY", "dairy", "Dairy"] }),
      );
      expect(dish.allergens).toEqual(["dairy"]);
    });
  });

  describe("translations", () => {
    it("keeps languages the restaurant offers", () => {
      const dish = firstDish(
        fileWithDish({ name: "D", translations: { name: { hi: "डी" } } }),
      );
      expect(dish.name_i18n).toEqual({ hi: "डी" });
    });

    it("drops a supported language the restaurant hasn't enabled", () => {
      const parsed = parseOrThrow(
        fileWithDish({ name: "D", translations: { name: { fr: "Le D", hi: "डी" } } }),
      );
      const dish = parsed.menu.categories[0].dishes[0];
      expect(dish.name_i18n).toEqual({ hi: "डी" });
      expect(parsed.warnings.some((w) => w.includes("fr"))).toBe(true);
      expect(parsed.warnings[0]).toMatch(/Settings/);
    });

    it("drops a language code the app doesn't support at all", () => {
      const parsed = parseOrThrow(
        fileWithDish({ name: "D", translations: { name: { xx: "??" } } }),
      );
      expect(parsed.menu.categories[0].dishes[0].name_i18n).toEqual({});
      expect(parsed.warnings[0]).toMatch(/unsupported language/);
    });

    it("ignores whitespace-only translations", () => {
      const dish = firstDish(
        fileWithDish({ name: "D", translations: { name: { hi: "   " } } }),
      );
      expect(dish.name_i18n).toEqual({});
    });
  });

  describe("rejections", () => {
    it("refuses a file that would empty the menu", () => {
      const res = parseMenuFile({ categories: [] }, LOCALES);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/empty your menu/);
    });

    it("refuses a category with no name", () => {
      expect(parseMenuFile({ categories: [{ dishes: [] }] }, LOCALES).ok).toBe(false);
    });

    it("refuses a dish with no name", () => {
      expect(parseMenuFile(fileWithDish({ price: 1 }), LOCALES).ok).toBe(false);
    });

    it("refuses a non-URL image_url", () => {
      expect(
        parseMenuFile(fileWithDish({ name: "D", image_url: "not-a-url" }), LOCALES).ok,
      ).toBe(false);
    });

    it("refuses more dishes than the limit, counting across categories", () => {
      const many = Array.from({ length: IMPORT_MAX_DISHES + 1 }, (_, i) => ({
        name: `D${i}`,
      }));
      const res = parseMenuFile(
        { categories: [{ name: "A", dishes: many.slice(0, 600) }], dishes: many.slice(600) },
        LOCALES,
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/limit is/);
    });

    it("reports the field path on a nested failure", () => {
      const res = parseMenuFile(fileWithDish({ name: "D", price: "x" }), LOCALES);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/categories\.0\.dishes\.0\.price/);
    });
  });

  describe("defaults and normalisation", () => {
    it("defaults availability to true and featured to false", () => {
      const dish = firstDish(fileWithDish({ name: "D" }));
      expect(dish.is_available).toBe(true);
      expect(dish.is_featured).toBe(false);
    });

    it("turns blank strings into nulls", () => {
      const dish = firstDish(fileWithDish({ name: "D", description: "   " }));
      expect(dish.description).toBeNull();
    });

    it("accepts a file of only uncategorized dishes", () => {
      const parsed = parseOrThrow({ dishes: [{ name: "Chai", price: 90 }] });
      expect(parsed.counts).toEqual({ categories: 0, dishes: 1 });
    });
  });
});

describe("serializeMenu", () => {
  const category: Category = {
    id: "c1",
    restaurant_id: "r1",
    name: "Mains",
    name_i18n: { hi: "मुख्य" },
    description: "Big plates",
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
  };

  const dish = (over: Partial<Dish> = {}): Dish => ({
    id: "d1",
    restaurant_id: "r1",
    category_id: "c1",
    name: "Dal",
    name_i18n: { hi: "दाल" },
    description: "Lentils",
    description_i18n: { hi: "दाल" },
    price_cents: 34050,
    image_url: "https://example.com/x.png",
    allergens: ["dairy"],
    dietary_tags: ["vegetarian"],
    is_available: false,
    is_featured: true,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  });

  it("writes prices back in major units", () => {
    const out = serializeMenu([category], [dish()]) as {
      categories: { dishes: { price: number }[] }[];
    };
    expect(out.categories[0].dishes[0].price).toBe(340.5);
  });

  it("files a dish whose category was deleted under uncategorized", () => {
    const orphan = dish({ id: "d2", category_id: "gone" });
    const out = serializeMenu([category], [orphan]) as {
      categories: { dishes: unknown[] }[];
      dishes: unknown[];
    };
    expect(out.categories[0].dishes).toHaveLength(0);
    expect(out.dishes).toHaveLength(1);
  });

  it("round-trips through the parser without loss", () => {
    const loose = dish({ id: "d2", category_id: null, name: "Chai", price_cents: 9000 });
    const exported = serializeMenu([category], [dish(), loose]);
    const parsed = parseOrThrow(exported);

    expect(parsed.warnings).toEqual([]);

    const back = parsed.menu.categories[0].dishes[0];
    expect(back.price_cents).toBe(34050);
    expect(back.is_available).toBe(false);
    expect(back.is_featured).toBe(true);
    expect(back.image_url).toBe("https://example.com/x.png");
    expect(back.name_i18n).toEqual({ hi: "दाल" });
    expect(back.description_i18n).toEqual({ hi: "दाल" });
    expect(back.allergens).toEqual(["dairy"]);

    expect(parsed.menu.categories[0].name_i18n).toEqual({ hi: "मुख्य" });
    expect(parsed.menu.dishes).toHaveLength(1);
    expect(parsed.menu.dishes[0].name).toBe("Chai");
  });

  it("round-trips an empty-ish menu that still has one dish", () => {
    const bare = dish({
      name: "Plain",
      name_i18n: {},
      description: null,
      description_i18n: {},
      image_url: null,
      allergens: [],
      dietary_tags: [],
    });
    const parsed = parseOrThrow(serializeMenu([category], [bare]));
    const back = parsed.menu.categories[0].dishes[0];
    expect(back.description).toBeNull();
    expect(back.image_url).toBeNull();
    expect(back.allergens).toEqual([]);
  });
});

describe("sampleMenuFile", () => {
  it("documents the currency it was generated for", () => {
    const sample = sampleMenuFile("INR") as { _readme: string[] };
    expect(sample._readme.some((line) => line.includes("INR"))).toBe(true);
  });

  it("warns in the file itself that importing replaces everything", () => {
    const sample = sampleMenuFile("USD") as { _readme: string[] };
    expect(sample._readme.some((line) => /REPLACES/i.test(line))).toBe(true);
  });
});
