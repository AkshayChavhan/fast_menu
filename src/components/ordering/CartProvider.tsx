"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  addLine,
  cartTotals,
  clearCart,
  removeLine,
  setCartNote,
  setLineNote,
  setQuantity,
  setServiceType,
  type Cart,
  type CartLine,
} from "@/lib/cart";
import { getServerSnapshot, getSnapshot, subscribe, updateCart } from "@/lib/cart-store";
import type { ServiceType } from "@/types/db";

interface CartApi {
  cart: Cart;
  /** False on the server and during hydration, when the cart reads as empty. */
  ready: boolean;
  count: number;
  subtotalCents: number;
  add: (line: Omit<CartLine, "key" | "quantity"> & { quantity?: number }) => void;
  setQty: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  setNote: (key: string, note: string | null) => void;
  setService: (serviceType: ServiceType) => void;
  setOrderNote: (note: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartApi | null>(null);

const noopSubscribe = () => () => {};

// Holds the guest's cart for one restaurant. The server and the hydration
// pass see an empty cart so markup matches; the browser's stored cart takes
// over immediately after, and every change is written straight back.
export function CartProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const cart = useSyncExternalStore(
    subscribe,
    () => getSnapshot(slug),
    () => getServerSnapshot(slug),
  );
  const ready = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const add = useCallback<CartApi["add"]>(
    (line) => updateCart(slug, (c) => addLine(c, line)),
    [slug],
  );
  const setQty = useCallback(
    (key: string, q: number) => updateCart(slug, (c) => setQuantity(c, key, q)),
    [slug],
  );
  const remove = useCallback((key: string) => updateCart(slug, (c) => removeLine(c, key)), [slug]);
  const setNote = useCallback(
    (key: string, note: string | null) => updateCart(slug, (c) => setLineNote(c, key, note)),
    [slug],
  );
  const setService = useCallback(
    (s: ServiceType) => updateCart(slug, (c) => setServiceType(c, s)),
    [slug],
  );
  const setOrderNote = useCallback(
    (note: string) => updateCart(slug, (c) => setCartNote(c, note)),
    [slug],
  );
  const clear = useCallback(() => updateCart(slug, (c) => clearCart(c)), [slug]);

  const value = useMemo<CartApi>(() => {
    const { count, subtotalCents } = cartTotals(cart);
    return { cart, ready, count, subtotalCents, add, setQty, remove, setNote, setService, setOrderNote, clear };
  }, [cart, ready, add, setQty, remove, setNote, setService, setOrderNote, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart() must be used inside <CartProvider>");
  return ctx;
}

// Same as useCart() but null outside a provider, for components that render
// on menus where ordering is off.
export function useOptionalCart(): CartApi | null {
  return useContext(CartContext);
}
