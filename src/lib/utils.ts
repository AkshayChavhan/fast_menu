import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Tailwind-aware className combiner.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format a price stored in minor units (cents) for display.
export function formatPrice(
  cents: number,
  currency = "USD",
  locale = "en",
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    // Fallback if an unknown currency/locale is passed.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

// Turn a display name into a URL-safe slug.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

// Pick a localized string from an i18n map, falling back to the base value.
export function localized(
  base: string,
  i18n: Record<string, string> | null | undefined,
  locale: string,
): string {
  if (i18n && i18n[locale]) return i18n[locale];
  return base;
}
