// Variants and add-ons: pure helpers shared by the dish form, the public
// menu, the guest's option sheet and the waiter's composer. Money is always
// integer minor units (cents / paise).

import type {
  Dish,
  ModifierGroup,
  ModifierGroupWithOptions,
  ModifierOption,
} from "@/types/db";

// Join flat rows into groups-with-options per dish, in display order.
export function groupModifiersByDish(
  groups: ModifierGroup[],
  options: ModifierOption[],
): Map<string, ModifierGroupWithOptions[]> {
  const optionsByGroup = new Map<string, ModifierOption[]>();
  for (const o of [...options].sort((a, b) => a.sort_order - b.sort_order)) {
    const list = optionsByGroup.get(o.group_id);
    if (list) list.push(o);
    else optionsByGroup.set(o.group_id, [o]);
  }

  const byDish = new Map<string, ModifierGroupWithOptions[]>();
  for (const g of [...groups].sort((a, b) => a.sort_order - b.sort_order)) {
    const withOptions = { ...g, options: optionsByGroup.get(g.id) ?? [] };
    const list = byDish.get(g.dish_id);
    if (list) list.push(withOptions);
    else byDish.set(g.dish_id, [withOptions]);
  }
  return byDish;
}

export function variantGroups(groups: ModifierGroupWithOptions[]) {
  return groups.filter((g) => g.kind === "variant");
}

export function addonGroups(groups: ModifierGroupWithOptions[]) {
  return groups.filter((g) => g.kind === "addon");
}

// The prices a dish can be ordered at, before add-ons: its own price, or
// the range of its available variant options. `from === to` when there is
// only one price to show.
export function dishPriceRange(
  dish: Pick<Dish, "price_cents">,
  groups: ModifierGroupWithOptions[],
): { from: number; to: number } {
  const variants = variantGroups(groups)
    .flatMap((g) => g.options)
    .filter((o) => o.is_available)
    .map((o) => o.price_cents);
  if (variants.length === 0) return { from: dish.price_cents, to: dish.price_cents };
  return { from: Math.min(...variants), to: Math.max(...variants) };
}

// Does ordering this dish need a choice from the guest?
export function needsChoice(groups: ModifierGroupWithOptions[]): boolean {
  return groups.some((g) => g.options.some((o) => o.is_available));
}

// What the guest picked: option ids per group.
export type ModifierSelection = Record<string, string[]>;

export interface PricedSelection {
  ok: true;
  unitPriceCents: number;
  // Snapshot for the order line, in group order.
  chosen: { groupId: string; groupName: string; optionId: string; name: string; priceCents: number; kind: "variant" | "addon" }[];
}

export interface SelectionProblem {
  ok: false;
  error: string;
}

// Price a selection and validate it against the groups' rules. This is the
// same logic the database re-runs when the order is placed, so the guest
// never sees a total the server would refuse.
export function priceSelection(
  dish: Pick<Dish, "price_cents">,
  groups: ModifierGroupWithOptions[],
  selection: ModifierSelection,
): PricedSelection | SelectionProblem {
  let unit = dish.price_cents;
  let variantChosen = false;
  const chosen: PricedSelection["chosen"] = [];

  for (const g of groups) {
    const available = g.options.filter((o) => o.is_available);
    const picked = (selection[g.id] ?? []).filter((id) => available.some((o) => o.id === id));

    if (g.kind === "variant") {
      if (available.length === 0) continue; // nothing to choose from; base price applies
      if (picked.length !== 1) return { ok: false, error: `Choose a ${g.name.toLowerCase()}` };
      const opt = available.find((o) => o.id === picked[0])!;
      unit = opt.price_cents;
      variantChosen = true;
      chosen.push({ groupId: g.id, groupName: g.name, optionId: opt.id, name: opt.name, priceCents: opt.price_cents, kind: "variant" });
      continue;
    }

    const unique = Array.from(new Set(picked));
    if (unique.length < g.min_select) {
      return {
        ok: false,
        error: g.min_select === 1 ? `Pick at least one ${g.name.toLowerCase()}` : `Pick at least ${g.min_select} ${g.name.toLowerCase()}`,
      };
    }
    if (g.max_select !== null && unique.length > g.max_select) {
      return {
        ok: false,
        error: g.max_select === 1 ? `Pick only one ${g.name.toLowerCase()}` : `Pick at most ${g.max_select} ${g.name.toLowerCase()}`,
      };
    }
    for (const id of unique) {
      const opt = available.find((o) => o.id === id)!;
      unit += opt.price_cents;
      chosen.push({ groupId: g.id, groupName: g.name, optionId: opt.id, name: opt.name, priceCents: opt.price_cents, kind: "addon" });
    }
  }

  void variantChosen;
  return { ok: true, unitPriceCents: unit, chosen };
}

// Preselect defaults: the default variant (or the first available one) per
// variant group; nothing for add-ons.
export function defaultSelection(groups: ModifierGroupWithOptions[]): ModifierSelection {
  const sel: ModifierSelection = {};
  for (const g of variantGroups(groups)) {
    const available = g.options.filter((o) => o.is_available);
    const def = available.find((o) => o.is_default) ?? available[0];
    if (def) sel[g.id] = [def.id];
  }
  return sel;
}

// Short summary for cards: "2 sizes · 3 add-ons".
export function describeModifiers(groups: ModifierGroupWithOptions[]): string | null {
  const parts: string[] = [];
  const v = variantGroups(groups).reduce((n, g) => n + g.options.length, 0);
  const a = addonGroups(groups).reduce((n, g) => n + g.options.length, 0);
  if (v > 0) parts.push(`${v} ${v === 1 ? "variant" : "variants"}`);
  if (a > 0) parts.push(`${a} ${a === 1 ? "add-on" : "add-ons"}`);
  return parts.length ? parts.join(" · ") : null;
}

// What the dish form submits for one group (prices as typed; the server
// converts to cents). Mirrors the payload set_dish_modifiers() accepts.
export interface ModifierOptionInput {
  name: string;
  price: string;
  is_available: boolean;
  is_default: boolean;
}

export interface ModifierGroupInput {
  name: string;
  kind: "variant" | "addon";
  min_select: number;
  max_select: number | null;
  options: ModifierOptionInput[];
}
