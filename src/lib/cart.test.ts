import { describe, it, expect } from "vitest";

import {
  CART_MAX_LINES,
  CART_MAX_QUANTITY,
  addLine,
  cartTotals,
  emptyCart,
  lineKey,
  removeLine,
  setLineNote,
  setQuantity,
  toOrderLines,
} from "@/lib/cart";

const paneer = {
  dishId: "d-paneer",
  name: "Paneer Tikka",
  unitPriceCents: 20000,
  note: null,
  variantOptionId: "half",
  addonOptionIds: ["chutney", "cheese"],
  optionSummary: "Half · Extra chutney · Cheese",
};

const chai = {
  dishId: "d-chai",
  name: "Chai",
  unitPriceCents: 4000,
  note: null,
  variantOptionId: null,
  addonOptionIds: [],
  optionSummary: "",
};

describe("lineKey()", () => {
  it("ignores add-on order and duplicates, and normalises the note", () => {
    expect(lineKey("d", "v", ["b", "a", "a"], "  hot ")).toBe(lineKey("d", "v", ["a", "b"], "hot"));
    expect(lineKey("d", "v", [], null)).toBe(lineKey("d", "v", [], "   "));
  });

  it("differs by dish, variant, add-ons and note", () => {
    const base = lineKey("d", "v", ["a"], null);
    expect(lineKey("x", "v", ["a"], null)).not.toBe(base);
    expect(lineKey("d", "w", ["a"], null)).not.toBe(base);
    expect(lineKey("d", "v", [], null)).not.toBe(base);
    expect(lineKey("d", "v", ["a"], "no onion")).not.toBe(base);
  });
});

describe("addLine()", () => {
  it("adds a line with a computed key and sorted add-ons", () => {
    const cart = addLine(emptyCart("cafe"), paneer);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(1);
    expect(cart.lines[0].addonOptionIds).toEqual(["cheese", "chutney"]);
    expect(cart.lines[0].key).toBe(lineKey("d-paneer", "half", ["cheese", "chutney"], null));
  });

  it("merges an identical line by adding quantity", () => {
    let cart = addLine(emptyCart("cafe"), { ...paneer, quantity: 2 });
    cart = addLine(cart, { ...paneer, addonOptionIds: ["cheese", "chutney"] });
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(3);
  });

  it("keeps a different note as its own line", () => {
    let cart = addLine(emptyCart("cafe"), chai);
    cart = addLine(cart, { ...chai, note: "less sugar" });
    expect(cart.lines).toHaveLength(2);
  });

  it("clamps quantity and refuses more than the line cap", () => {
    let cart = addLine(emptyCart("cafe"), { ...chai, quantity: 500 });
    expect(cart.lines[0].quantity).toBe(CART_MAX_QUANTITY);
    for (let i = 0; i < CART_MAX_LINES + 5; i++) {
      cart = addLine(cart, { ...chai, dishId: `d-${i}` });
    }
    expect(cart.lines.length).toBe(CART_MAX_LINES);
  });
});

describe("quantities and removal", () => {
  it("sets a quantity and removes at zero", () => {
    let cart = addLine(emptyCart("cafe"), chai);
    const key = cart.lines[0].key;
    cart = setQuantity(cart, key, 4);
    expect(cart.lines[0].quantity).toBe(4);
    cart = setQuantity(cart, key, 0);
    expect(cart.lines).toHaveLength(0);
  });

  it("removes by key", () => {
    let cart = addLine(addLine(emptyCart("cafe"), chai), paneer);
    cart = removeLine(cart, cart.lines[0].key);
    expect(cart.lines.map((l) => l.dishId)).toEqual(["d-paneer"]);
  });
});

describe("setLineNote()", () => {
  it("re-keys the line and merges into a twin", () => {
    let cart = addLine(emptyCart("cafe"), { ...chai, quantity: 2 });
    cart = addLine(cart, { ...chai, note: "less sugar" });
    const plainKey = cart.lines[0].key;
    cart = setLineNote(cart, plainKey, "less sugar");
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(3);
    expect(cart.lines[0].note).toBe("less sugar");
  });
});

describe("totals and payload", () => {
  it("counts items and sums line prices", () => {
    let cart = addLine(emptyCart("cafe"), { ...paneer, quantity: 2 });
    cart = addLine(cart, chai);
    expect(cartTotals(cart)).toEqual({ count: 3, subtotalCents: 44000 });
  });

  it("produces the place_order line shape", () => {
    const cart = addLine(emptyCart("cafe"), { ...paneer, quantity: 2, note: "mint" });
    expect(toOrderLines(cart)).toEqual([
      {
        dish_id: "d-paneer",
        quantity: 2,
        note: "mint",
        variant_option_id: "half",
        addon_option_ids: ["cheese", "chutney"],
      },
    ]);
  });
});
