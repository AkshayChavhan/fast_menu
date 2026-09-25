import { describe, it, expect } from "vitest";

import {
  defaultSelection,
  describeModifiers,
  dishPriceRange,
  groupModifiersByDish,
  needsChoice,
  priceSelection,
} from "@/lib/modifiers";
import type { ModifierGroup, ModifierGroupWithOptions, ModifierOption } from "@/types/db";

const base = { restaurant_id: "r1", name_i18n: {}, created_at: "", updated_at: "" };

function group(
  over: Partial<ModifierGroup> & Pick<ModifierGroup, "id" | "kind" | "name">,
  options: Array<Partial<ModifierOption> & Pick<ModifierOption, "id" | "name" | "price_cents">>,
): ModifierGroupWithOptions {
  return {
    ...base,
    dish_id: "d1",
    min_select: over.kind === "variant" ? 1 : 0,
    max_select: over.kind === "variant" ? 1 : null,
    sort_order: 0,
    ...over,
    options: options.map((o, i) => ({
      ...base,
      group_id: over.id,
      is_available: true,
      is_default: false,
      sort_order: i,
      ...o,
    })),
  };
}

const size = group({ id: "g-size", kind: "variant", name: "Size" }, [
  { id: "half", name: "Half", price_cents: 12000, is_default: true },
  { id: "full", name: "Full", price_cents: 20000 },
]);

const extras = group(
  { id: "g-extras", kind: "addon", name: "Extras", min_select: 0, max_select: 2 },
  [
    { id: "cheese", name: "Cheese", price_cents: 2000 },
    { id: "egg", name: "Egg", price_cents: 1500 },
    { id: "bacon", name: "Bacon", price_cents: 3000, is_available: false },
  ],
);

const dish = { price_cents: 15000 };

describe("groupModifiersByDish()", () => {
  it("nests options under their group, per dish, in sort order", () => {
    const groups: ModifierGroup[] = [
      { ...base, id: "gB", dish_id: "d1", name: "B", kind: "addon", min_select: 0, max_select: null, sort_order: 1 },
      { ...base, id: "gA", dish_id: "d1", name: "A", kind: "variant", min_select: 1, max_select: 1, sort_order: 0 },
      { ...base, id: "gC", dish_id: "d2", name: "C", kind: "addon", min_select: 0, max_select: null, sort_order: 0 },
    ];
    const options: ModifierOption[] = [
      { ...base, id: "o2", group_id: "gA", name: "Second", price_cents: 2, is_available: true, is_default: false, sort_order: 1 },
      { ...base, id: "o1", group_id: "gA", name: "First", price_cents: 1, is_available: true, is_default: false, sort_order: 0 },
    ];
    const byDish = groupModifiersByDish(groups, options);
    expect(byDish.get("d1")?.map((g) => g.id)).toEqual(["gA", "gB"]);
    expect(byDish.get("d1")?.[0].options.map((o) => o.id)).toEqual(["o1", "o2"]);
    expect(byDish.get("d2")?.[0].options).toEqual([]);
  });
});

describe("dishPriceRange()", () => {
  it("is the dish price when there are no variants", () => {
    expect(dishPriceRange(dish, [extras])).toEqual({ from: 15000, to: 15000 });
  });

  it("spans the available variant prices", () => {
    expect(dishPriceRange(dish, [size, extras])).toEqual({ from: 12000, to: 20000 });
  });

  it("ignores unavailable variants", () => {
    const only = group({ id: "g", kind: "variant", name: "Size" }, [
      { id: "a", name: "A", price_cents: 100, is_available: false },
      { id: "b", name: "B", price_cents: 300 },
    ]);
    expect(dishPriceRange(dish, [only])).toEqual({ from: 300, to: 300 });
  });
});

describe("priceSelection()", () => {
  it("prices a plain dish with no groups", () => {
    const res = priceSelection(dish, [], {});
    expect(res).toEqual({ ok: true, unitPriceCents: 15000, chosen: [] });
  });

  it("replaces the price with the chosen variant and adds add-ons", () => {
    const res = priceSelection(dish, [size, extras], {
      "g-size": ["full"],
      "g-extras": ["cheese", "egg"],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.unitPriceCents).toBe(20000 + 2000 + 1500);
    expect(res.chosen.map((c) => c.name)).toEqual(["Full", "Cheese", "Egg"]);
  });

  it("requires exactly one variant", () => {
    expect(priceSelection(dish, [size], {})).toEqual({ ok: false, error: "Choose a size" });
    expect(priceSelection(dish, [size], { "g-size": ["half", "full"] }).ok).toBe(false);
  });

  it("enforces add-on min and max", () => {
    const required = { ...extras, min_select: 1 };
    expect(priceSelection(dish, [required], {})).toEqual({
      ok: false,
      error: "Pick at least one extras",
    });
    expect(
      priceSelection(dish, [extras], { "g-extras": ["cheese", "egg", "cheese"] }).ok,
    ).toBe(true); // duplicates collapse
    const three = group({ id: "g3", kind: "addon", name: "Sides", max_select: 1 }, [
      { id: "a", name: "A", price_cents: 1 },
      { id: "b", name: "B", price_cents: 1 },
    ]);
    expect(priceSelection(dish, [three], { g3: ["a", "b"] })).toEqual({
      ok: false,
      error: "Pick only one sides",
    });
  });

  it("silently drops unavailable or unknown option ids", () => {
    const res = priceSelection(dish, [extras], { "g-extras": ["bacon", "nope"] });
    expect(res).toEqual({ ok: true, unitPriceCents: 15000, chosen: [] });
  });

  it("falls back to the base price when a variant group has nothing available", () => {
    const empty = group({ id: "g", kind: "variant", name: "Size" }, [
      { id: "a", name: "A", price_cents: 100, is_available: false },
    ]);
    expect(priceSelection(dish, [empty], {})).toEqual({ ok: true, unitPriceCents: 15000, chosen: [] });
  });
});

describe("defaultSelection() and needsChoice()", () => {
  it("preselects the default variant, or the first available one", () => {
    expect(defaultSelection([size, extras])).toEqual({ "g-size": ["half"] });
    const noDefault = group({ id: "g", kind: "variant", name: "Size" }, [
      { id: "a", name: "A", price_cents: 1, is_available: false },
      { id: "b", name: "B", price_cents: 2 },
    ]);
    expect(defaultSelection([noDefault])).toEqual({ g: ["b"] });
  });

  it("knows when a dish needs the sheet", () => {
    expect(needsChoice([])).toBe(false);
    expect(needsChoice([extras])).toBe(true);
    const allOff = group({ id: "g", kind: "addon", name: "X" }, [
      { id: "a", name: "A", price_cents: 1, is_available: false },
    ]);
    expect(needsChoice([allOff])).toBe(false);
  });
});

describe("describeModifiers()", () => {
  it("summarises counts for cards", () => {
    expect(describeModifiers([])).toBeNull();
    expect(describeModifiers([size])).toBe("2 variants");
    expect(describeModifiers([size, extras])).toBe("2 variants · 3 add-ons");
  });
});
