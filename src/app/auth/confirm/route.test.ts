import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const verifyOtp = vi.hoisted(() => vi.fn());
const exchangeCodeForSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp, exchangeCodeForSession } }),
}));

import { GET } from "./route";

function call(query: string) {
  return GET(new NextRequest(`https://menu.test/auth/confirm${query}`));
}

function target(res: Response) {
  const url = new URL(res.headers.get("location")!);
  return url.pathname + url.search;
}

beforeEach(() => {
  verifyOtp.mockResolvedValue({ error: null });
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe("GET /auth/confirm", () => {
  it("verifies a token_hash link and lands on /auth/home", async () => {
    const res = await call("?token_hash=abc&type=email");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "abc" });
    expect(target(res)).toBe("/auth/home");
  });

  it("exchanges a PKCE ?code link for a session", async () => {
    const res = await call("?code=xyz");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("xyz");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(target(res)).toBe("/auth/home");
  });

  it("honours a same-origin next but not an off-site one", async () => {
    expect(target(await call("?code=x&next=/dashboard/menu"))).toBe(
      "/dashboard/menu",
    );
    expect(target(await call("?code=x&next=//evil.test"))).toBe("/auth/home");
    expect(target(await call("?code=x&next=https://evil.test"))).toBe(
      "/auth/home",
    );
  });

  it("sends a failed verification back to login with a flag", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    expect(target(await call("?token_hash=abc&type=email"))).toBe(
      "/login?error=confirmation_failed",
    );

    exchangeCodeForSession.mockResolvedValue({ error: { message: "bad" } });
    expect(target(await call("?code=xyz"))).toBe(
      "/login?error=confirmation_failed",
    );
  });

  it("treats a bare visit with no params as a failure", async () => {
    expect(target(await call(""))).toBe("/login?error=confirmation_failed");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
