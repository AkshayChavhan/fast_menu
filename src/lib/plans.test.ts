import { describe, it, expect } from "vitest";

import {
  PLAN_FEATURES,
  effectivePlan,
  planAllows,
  staffLimit,
  localeLimit,
  isPlan,
  STARTER_LOCALE_LIMIT,
  PRO_STAFF_LIMIT,
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
  it("honours a paid plan with no end date", () => {
    expect(at({ plan: "pro", plan_expires_at: null })).toBe("pro");
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
