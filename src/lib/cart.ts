// The guest's cart: a pure model plus small browser-storage helpers. Prices
// held here are for display only; the database re-prices every line when
// the order is placed (see place_order / insert_order_items).

import type { OrderLineInput, ServiceType } from "@/types/db";

export interface CartLine {
  /** Identity of the line: dish + variant + add-ons + note. */
  key: string;
  dishId: string;
  /** Localised dish name, for display. */
  name: string;
  /** Unit price as the menu showed it, for display. */
  unitPriceCents: number;
  quantity: number;
  note: string | null;
  variantOptionId: string | null;
  addonOptionIds: string[];
  /** "Half · Extra chutney" — what was chosen, for display. */
  optionSummary: string;
}

export interface Cart {
  slug: string;
  lines: CartLine[];
  serviceType: ServiceType;
  note: string;
  /** Epoch millis of the last change; stale carts are dropped on load. */
  updatedAt: number;
}

export const CART_MAX_LINES = 50;
export const CART_MAX_QUANTITY = 99;
export const CART_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const normNote = (note: string | null | undefined) => (note ?? "").trim().slice(0, 200) || null;

// Same dish, same choices, same note → same line, regardless of the order
// the add-ons were ticked in.
export function lineKey(
  dishId: string,
  variantOptionId: string | null,
  addonOptionIds: string[],
  note: string | null,
): string {
  const addons = Array.from(new Set(addonOptionIds)).sort().join(",");
  return [dishId, variantOptionId ?? "", addons, normNote(note) ?? ""].join("|");
}

export function emptyCart(slug: string): Cart {
  return { slug, lines: [], serviceType: "dine_in", note: "", updatedAt: Date.now() };
}

const touch = (cart: Cart, lines: CartLine[]): Cart => ({ ...cart, lines, updatedAt: Date.now() });

// Add a line; an identical line already in the cart just gains quantity.
export function addLine(cart: Cart, input: Omit<CartLine, "key" | "quantity"> & { quantity?: number }): Cart {
  const note = normNote(input.note);
  const addonOptionIds = Array.from(new Set(input.addonOptionIds)).sort();
  const key = lineKey(input.dishId, input.variantOptionId, addonOptionIds, note);
  const qty = Math.max(1, Math.min(CART_MAX_QUANTITY, Math.floor(input.quantity ?? 1)));

  const existing = cart.lines.find((l) => l.key === key);
  if (existing) {
    return setQuantity(cart, key, existing.quantity + qty);
  }
  if (cart.lines.length >= CART_MAX_LINES) return cart;
  return touch(cart, [
    ...cart.lines,
    { ...input, key, note, addonOptionIds, quantity: qty },
  ]);
}

// Zero removes the line; anything above the cap is clamped.
export function setQuantity(cart: Cart, key: string, quantity: number): Cart {
  const qty = Math.floor(quantity);
  if (qty <= 0) return removeLine(cart, key);
  return touch(
    cart,
    cart.lines.map((l) =>
      l.key === key ? { ...l, quantity: Math.min(CART_MAX_QUANTITY, qty) } : l,
    ),
  );
}

export function removeLine(cart: Cart, key: string): Cart {
  return touch(cart, cart.lines.filter((l) => l.key !== key));
}

// A note is part of a line's identity; changing it re-keys the line and
// merges it into a matching one if there is one.
export function setLineNote(cart: Cart, key: string, note: string | null): Cart {
  const line = cart.lines.find((l) => l.key === key);
  if (!line) return cart;
  const nextNote = normNote(note);
  const nextKey = lineKey(line.dishId, line.variantOptionId, line.addonOptionIds, nextNote);
  const without = cart.lines.filter((l) => l.key !== key);
  const twin = without.find((l) => l.key === nextKey);
  if (twin) {
    return touch(
      cart,
      without.map((l) =>
        l.key === nextKey ? { ...l, quantity: Math.min(CART_MAX_QUANTITY, l.quantity + line.quantity) } : l,
      ),
    );
  }
  return touch(
    cart,
    cart.lines.map((l) => (l.key === key ? { ...l, note: nextNote, key: nextKey } : l)),
  );
}

export function setServiceType(cart: Cart, serviceType: ServiceType): Cart {
  return { ...cart, serviceType, updatedAt: Date.now() };
}

export function setCartNote(cart: Cart, note: string): Cart {
  return { ...cart, note: note.slice(0, 300), updatedAt: Date.now() };
}

export function clearCart(cart: Cart): Cart {
  return emptyCart(cart.slug);
}

export function cartTotals(cart: Cart): { count: number; subtotalCents: number } {
  let count = 0;
  let subtotalCents = 0;
  for (const l of cart.lines) {
    count += l.quantity;
    subtotalCents += l.unitPriceCents * l.quantity;
  }
  return { count, subtotalCents };
}

// The payload place_order() accepts.
export function toOrderLines(cart: Cart): OrderLineInput[] {
  return cart.lines.map((l) => ({
    dish_id: l.dishId,
    quantity: l.quantity,
    note: l.note,
    variant_option_id: l.variantOptionId,
    addon_option_ids: l.addonOptionIds,
  }));
}

// --- Browser storage --------------------------------------------------------
// Per-viewer convenience only: a cart lives in this browser and nowhere else.
// Every access is guarded because private windows and blocked storage throw.

const CART_PREFIX = "fm-cart:";
const DEVICE_KEY = "fm-device";
const LAST_ORDER_PREFIX = "fm-last-order:";

export function loadCart(slug: string): Cart {
  try {
    const raw = window.localStorage.getItem(CART_PREFIX + slug);
    if (!raw) return emptyCart(slug);
    const parsed = JSON.parse(raw) as Partial<Cart>;
    if (!parsed || parsed.slug !== slug || !Array.isArray(parsed.lines)) return emptyCart(slug);
    if (typeof parsed.updatedAt !== "number" || Date.now() - parsed.updatedAt > CART_MAX_AGE_MS) {
      return emptyCart(slug);
    }
    return {
      slug,
      lines: parsed.lines.filter(isCartLine),
      serviceType: parsed.serviceType === "takeaway" ? "takeaway" : "dine_in",
      note: typeof parsed.note === "string" ? parsed.note : "",
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return emptyCart(slug);
  }
}

export function saveCart(cart: Cart): void {
  try {
    if (cart.lines.length === 0 && !cart.note) {
      window.localStorage.removeItem(CART_PREFIX + cart.slug);
    } else {
      window.localStorage.setItem(CART_PREFIX + cart.slug, JSON.stringify(cart));
    }
  } catch {
    /* storage unavailable: the cart simply lives in memory for this visit */
  }
}

function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false;
  const l = value as Record<string, unknown>;
  return (
    typeof l.key === "string" &&
    typeof l.dishId === "string" &&
    typeof l.name === "string" &&
    typeof l.unitPriceCents === "number" &&
    typeof l.quantity === "number" &&
    l.quantity > 0 &&
    Array.isArray(l.addonOptionIds)
  );
}

// A random id for this browser so it can cancel and replace its own
// unapproved order. Not an identity: it never leaves the order row.
export function getDeviceKey(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return "";
  }
}

export function rememberLastOrder(slug: string, code: string): void {
  try {
    window.localStorage.setItem(LAST_ORDER_PREFIX + slug, code);
  } catch {
    /* ignore */
  }
}

export function lastOrderCode(slug: string): string | null {
  try {
    return window.localStorage.getItem(LAST_ORDER_PREFIX + slug);
  } catch {
    return null;
  }
}

export function forgetLastOrder(slug: string): void {
  try {
    window.localStorage.removeItem(LAST_ORDER_PREFIX + slug);
  } catch {
    /* ignore */
  }
}
