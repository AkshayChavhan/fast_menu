import { describe, it, expect } from "vitest";

import { cn, formatPrice, slugify, localized } from "@/lib/utils";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
  });

  it("lets a later tailwind class win over an earlier conflicting one", () => {
    // This is the whole reason for twMerge: conditional variants are appended
    // after base classes and must override them.
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("text-neutral-500", "text-red-600")).toBe("text-red-600");
  });
});

describe("formatPrice", () => {
  it("renders minor units as a currency amount", () => {
    // Non-breaking spaces vary by ICU version, so assert on the parts.
    const out = formatPrice(1250, "USD", "en");
    expect(out).toContain("12.50");
    expect(out).toContain("$");
  });

  it("handles zero", () => {
    expect(formatPrice(0, "USD", "en")).toContain("0.00");
  });

  it("formats INR", () => {
    expect(formatPrice(32000, "INR", "en")).toContain("320.00");
  });

  it("falls back rather than throwing on an unknown currency", () => {
    // Intl throws on a bad currency code; the menu must still render.
    expect(formatPrice(1250, "NOTACURRENCY", "en")).toBe("12.50 NOTACURRENCY");
  });

  it("falls back rather than throwing on a bad locale", () => {
    expect(() => formatPrice(1250, "USD", "!!bad!!")).not.toThrow();
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("My Great Cafe")).toBe("my-great-cafe");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugify("Joe's   Bar & Grill!!")).toBe("joe-s-bar-grill");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  --Hello--  ")).toBe("hello");
  });

  it("strips accents rather than dropping the letter", () => {
    expect(slugify("Café Crème")).toBe("cafe-creme");
    expect(slugify("Piñata")).toBe("pinata");
  });

  it("returns an empty string when nothing survives", () => {
    // The settings action relies on this to reject a slug of pure punctuation.
    expect(slugify("!!!")).toBe("");
    expect(slugify("日本語")).toBe("");
  });
});

describe("localized", () => {
  it("returns the translation when present", () => {
    expect(localized("Lentils", { hi: "दाल" }, "hi")).toBe("दाल");
  });

  it("falls back to the base string when the locale is missing", () => {
    expect(localized("Lentils", { fr: "Lentilles" }, "hi")).toBe("Lentils");
  });

  it("tolerates a null or undefined map", () => {
    expect(localized("Lentils", null, "hi")).toBe("Lentils");
    expect(localized("Lentils", undefined, "hi")).toBe("Lentils");
  });

  it("falls back when the translation is an empty string", () => {
    expect(localized("Lentils", { hi: "" }, "hi")).toBe("Lentils");
  });
});
