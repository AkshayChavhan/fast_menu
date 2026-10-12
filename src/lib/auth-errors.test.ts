import { describe, it, expect } from "vitest";

import {
  friendlyAuthError,
  isEmailNotConfirmed,
  isEmailRateLimit,
} from "@/lib/auth-errors";

describe("isEmailRateLimit", () => {
  it("matches by code and by the older message-only form", () => {
    expect(
      isEmailRateLimit({
        message: "x",
        code: "over_email_send_rate_limit",
      }),
    ).toBe(true);
    expect(isEmailRateLimit({ message: "email rate limit exceeded" })).toBe(
      true,
    );
    expect(isEmailRateLimit({ message: "Invalid login credentials" })).toBe(
      false,
    );
  });
});

describe("isEmailNotConfirmed", () => {
  it("matches by code and by message", () => {
    expect(
      isEmailNotConfirmed({ message: "x", code: "email_not_confirmed" }),
    ).toBe(true);
    expect(isEmailNotConfirmed({ message: "Email not confirmed" })).toBe(true);
    expect(isEmailNotConfirmed({ message: "Invalid login credentials" })).toBe(
      false,
    );
  });
});

describe("friendlyAuthError", () => {
  it("rewrites the rate-limit and unconfirmed cases", () => {
    expect(friendlyAuthError({ message: "email rate limit exceeded" })).toMatch(
      /too many emails/i,
    );
    expect(friendlyAuthError({ message: "Email not confirmed" })).toMatch(
      /isn't confirmed/i,
    );
    expect(friendlyAuthError({ message: "x", status: 429 })).toMatch(
      /too many attempts/i,
    );
  });

  it("passes anything else through unchanged", () => {
    expect(
      friendlyAuthError({ message: "Password should be at least 6 characters." }),
    ).toBe("Password should be at least 6 characters.");
  });
});
