import { describe, it, expect } from "vitest";

import { hasSessionCookie, isProtectedPath } from "@/lib/supabase/middleware";

describe("isProtectedPath", () => {
  it("protects each signed-in area and everything under it", () => {
    for (const area of [
      "/dashboard",
      "/waiter",
      "/kitchen",
      "/onboarding",
      "/admin",
    ]) {
      expect(isProtectedPath(area)).toBe(true);
      expect(isProtectedPath(`${area}/tables`)).toBe(true);
      expect(isProtectedPath(`${area}/tables/new`)).toBe(true);
    }
  });

  // The regression that caused ERR_TOO_MANY_REDIRECTS: the predicate tested
  // `pathname.startsWith("/")`, which is true of every path ever requested, so
  // /login was "protected" and redirected to itself forever.
  it("leaves the public pages alone — above all /login", () => {
    for (const path of [
      "/login",
      "/signup",
      "/",
      "/m/some-restaurant",
      "/r/some-restaurant",
      "/offline",
      "/auth/confirm",
      "/api/qr",
    ]) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });

  it("does not let a lookalike prefix sneak past the gate", () => {
    expect(isProtectedPath("/dashboardish")).toBe(false);
    expect(isProtectedPath("/admin-signup")).toBe(false);
    expect(isProtectedPath("/waiters")).toBe(false);
  });
});

describe("hasSessionCookie", () => {
  it("recognises Supabase's session cookie, chunked or not", () => {
    expect(hasSessionCookie(["sb-abcdefgh-auth-token"])).toBe(true);
    expect(hasSessionCookie(["sb-abcdefgh-auth-token.0", "sb-abcdefgh-auth-token.1"])).toBe(true);
    expect(hasSessionCookie(["_ga", "sb-abcdefgh-auth-token-code-verifier"])).toBe(true);
  });

  it("sees a guest for what they are: no auth cookie at all", () => {
    expect(hasSessionCookie([])).toBe(false);
    expect(hasSessionCookie(["_ga", "cart", "sb-abcdefgh-something-else"])).toBe(false);
  });
});
