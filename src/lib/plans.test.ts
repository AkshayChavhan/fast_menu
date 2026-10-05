import { describe, it, expect } from "vitest";

import {
  PLAN_FEATURES,
  effectivePlan,
  planAllows,
  staffLimit,
  localeLimit,
  isPlan,
  isLive,
  isInGrace,
  graceEndsAt,
  STARTER_LOCALE_LIMIT,
  PRO_STAFF_LIMIT,
  PLAN_GRACE_DAYS,
} from "@/lib/plans";
import type { Restaurant } from "@/types/db";

const NOW = new Date("2026-10-05T12:00:00Z");
const future = "2026-12-01T00:00:00Z";
const past = "2026-09-01T00:00:00Z";

// Only the four columns effectivePlan reads.
const at = (
  o: Partial<Pick<Restaurant, "plan" | "plan_expires_at" | "trial_status" | "trial_ends_at">>,
) =>
  effectivePlan(
    {
      plan: "starter",
      plan_expires_at: null,
      trial_status: "pending",
      trial_ends_at: past,
      ...o,
    },
    NOW,
  );

describe("planAllows", () => {
  it("gives starter none of the gated features", () => {
    for (const f of PLAN_FEATURES) expect(planAllows("starter", f)).toBe(false);
  });

  it("gives pro all of them", () => {
    for (const f of PLAN_FEATURES) expect(planAllows("pro", f)).toBe(true);
  });
});

describe("limits", () => {
  it("lets starter have no staff and pro have ten", () => {
    expect(staffLimit("starter")).toBe(0);
    expect(staffLimit("pro")).toBe(PRO_STAFF_LIMIT);
  });

  it("caps starter languages but not pro", () => {
    expect(localeLimit("starter")).toBe(STARTER_LOCALE_LIMIT);
    expect(localeLimit("pro")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("effectivePlan", () => {
  // NULL means no paid subscription, not "forever" — comping an account is
  // done by setting the date far out.
  it("does not treat a missing end date as a subscription", () => {
    expect(at({ plan: "pro", plan_expires_at: null })).toBe("starter");
  });

  it("honours a paid plan inside its term", () => {
    expect(at({ plan: "pro", plan_expires_at: future })).toBe("pro");
  });

  // The point of computing rather than storing: nothing has to run on renewal
  // day for the downgrade to take effect.
  it("falls back to starter the moment a paid plan expires", () => {
    expect(at({ plan: "pro", plan_expires_at: past })).toBe("starter");
  });

  it("runs a live trial as pro, so ordering can be felt before paying", () => {
    expect(at({ trial_status: "active", trial_ends_at: future })).toBe("pro");
  });

  it("keeps a hotel under review on pro while it builds", () => {
    expect(at({ trial_status: "needs_review", trial_ends_at: future })).toBe("pro");
  });

  it("drops to starter once the trial runs out", () => {
    expect(at({ trial_status: "active", trial_ends_at: past })).toBe("starter");
  });

  it("gives an unclaimed or denied trial nothing", () => {
    expect(at({ trial_status: "pending", trial_ends_at: future })).toBe("starter");
    expect(at({ trial_status: "denied", trial_ends_at: future })).toBe("starter");
  });

  // An expired trial must not drag down a customer who has since paid.
  it("lets a paid plan outrank a dead trial", () => {
    expect(
      at({ plan: "pro", plan_expires_at: future, trial_status: "denied", trial_ends_at: past }),
    ).toBe("pro");
  });

  it("survives a malformed trial date", () => {
    expect(at({ trial_status: "active", trial_ends_at: "not-a-date" })).toBe("starter");
  });
});

describe("isPlan", () => {
  it("accepts the two plans and nothing else", () => {
    expect(isPlan("starter")).toBe(true);
    expect(isPlan("pro")).toBe(true);
    expect(isPlan("enterprise")).toBe(false);
    expect(isPlan("")).toBe(false);
  });
});

describe("isLive", () => {
  const live = (
    o: Partial<
      Pick<
        Restaurant,
        "is_published" | "plan" | "plan_expires_at" | "trial_status" | "trial_ends_at"
      >
    >,
  ) =>
    isLive(
      {
        is_published: true,
        plan: "starter",
        plan_expires_at: null,
        trial_status: "pending",
        trial_ends_at: past,
        ...o,
      },
      NOW,
    );

  const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  it("is never live while unpublished, whatever has been paid", () => {
    expect(live({ is_published: false, plan: "pro", plan_expires_at: future })).toBe(false);
  });

  it("is live on a current paid term", () => {
    expect(live({ plan_expires_at: future })).toBe(true);
  });

  // The reason the grace period exists: a printed QR code glued to a table
  // must not stop working the day a card fails.
  it("stays live just inside the grace period", () => {
    expect(live({ plan_expires_at: daysAgo(PLAN_GRACE_DAYS - 1) })).toBe(true);
  });

  it("goes dark just past it", () => {
    expect(live({ plan_expires_at: daysAgo(PLAN_GRACE_DAYS + 1) })).toBe(false);
  });

  it("gives a lapsed trial the same grace", () => {
    expect(live({ trial_ends_at: daysAgo(1) })).toBe(true);
    expect(live({ trial_ends_at: daysAgo(PLAN_GRACE_DAYS + 1) })).toBe(false);
  });

  // The whole point of the INR 2,000 plan: a live menu, no ordering.
  it("keeps a paid starter live without making it pro", () => {
    const r = {
      is_published: true,
      plan: "starter" as const,
      plan_expires_at: future,
      trial_status: "denied" as const,
      trial_ends_at: past,
    };
    expect(isLive(r, NOW)).toBe(true);
    expect(effectivePlan(r, NOW)).toBe("starter");
  });

  // In grace the menu is up but ordering is already off.
  it("drops to starter in grace while the menu stays up", () => {
    const r = {
      is_published: true,
      plan: "pro" as const,
      plan_expires_at: daysAgo(1),
      trial_status: "denied" as const,
      trial_ends_at: past,
    };
    expect(isLive(r, NOW)).toBe(true);
    expect(effectivePlan(r, NOW)).toBe("starter");
  });

  it("names the lapsed-but-still-up window", () => {
    const base = {
      is_published: true,
      trial_status: "denied" as const,
      trial_ends_at: past,
    };
    // Lapsed a day ago: menu up, ordering off.
    expect(isInGrace({ ...base, plan: "pro", plan_expires_at: daysAgo(1) }, NOW)).toBe(true);
    // Still paying: not grace.
    expect(isInGrace({ ...base, plan: "pro", plan_expires_at: future }, NOW)).toBe(false);
    // Long dead: dark, not grace.
    expect(
      isInGrace({ ...base, plan: "pro", plan_expires_at: daysAgo(PLAN_GRACE_DAYS + 1) }, NOW),
    ).toBe(false);
  });

  it("says when the menu will go dark, and only while lapsed", () => {
    const base = {
      is_published: true,
      trial_status: "denied" as const,
      trial_ends_at: past,
    };
    const lapsed = { ...base, plan: "pro" as const, plan_expires_at: daysAgo(1) };
    const ends = graceEndsAt(lapsed, NOW);
    expect(ends).not.toBeNull();
    // A day lapsed, so the menu has the rest of the grace window left.
    expect(ends!.getTime() - NOW.getTime()).toBeGreaterThan(
      (PLAN_GRACE_DAYS - 2) * 24 * 60 * 60 * 1000,
    );

    // Nothing to warn about while they are paying.
    expect(graceEndsAt({ ...base, plan: "pro", plan_expires_at: future }, NOW)).toBeNull();
  });
});
