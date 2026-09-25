// A tiny external store over the browser's stored cart, for
// useSyncExternalStore: server and hydration render an empty cart, the
// client switches to the stored one right after, and other tabs see changes
// through the storage event. Snapshots are cached per slug so React gets a
// stable reference until something actually changes.

import { emptyCart, loadCart, saveCart, type Cart } from "@/lib/cart";

const listeners = new Set<() => void>();
const snapshots = new Map<string, Cart>();
const serverSnapshots = new Map<string, Cart>();
let storageListenerAttached = false;

function notify() {
  for (const l of listeners) l();
}

function attachStorageListener() {
  if (storageListenerAttached || typeof window === "undefined") return;
  storageListenerAttached = true;
  window.addEventListener("storage", (e) => {
    if (e.key && e.key.startsWith("fm-cart:")) {
      snapshots.delete(e.key.slice("fm-cart:".length));
      notify();
    }
  });
}

export function subscribe(callback: () => void): () => void {
  attachStorageListener();
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function getSnapshot(slug: string): Cart {
  let cart = snapshots.get(slug);
  if (!cart) {
    cart = loadCart(slug);
    snapshots.set(slug, cart);
  }
  return cart;
}

export function getServerSnapshot(slug: string): Cart {
  let cart = serverSnapshots.get(slug);
  if (!cart) {
    cart = emptyCart(slug);
    serverSnapshots.set(slug, cart);
  }
  return cart;
}

export function updateCart(slug: string, fn: (cart: Cart) => Cart): void {
  const next = fn(getSnapshot(slug));
  snapshots.set(slug, next);
  saveCart(next);
  notify();
}
