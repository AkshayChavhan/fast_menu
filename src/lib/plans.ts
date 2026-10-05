// Subscription plans.
//
// starter (INR 2,000/yr) is the menu. pro (INR 5,000/yr) adds the things that
// run a floor — table ordering, the waiter app, the kitchen screen, the
// billing counter — plus staff logins, every language and schedules.
//
// This module decides what a plan allows. The database enforces the same rules
// for the parts that matter (see migrations/*_plans.sql): UI gating alone is
// bypassable with the anon key, so anything that creates an order is checked
// there too. Keep restaurant_plan() and effectivePlan() in step.

import type { Restaurant } from "@/types/db";

export const PLANS = ["starter", "pro"] as const;
export type Plan = (typeof PLANS)[number];

export const PLAN_FEATURES = [
  // Table ordering end to end: guest cart, per-table QR, waiter app, kitchen
  // screen, billing counter, pause.
  "ordering",
  // Staff logins beyond the owner.
  "staff",
  // Menu schedules and date-ranged daily specials.
  "schedules",
  // More than STARTER_LOCALE_LIMIT languages on the menu.
  "languages",
  // Drop the fast_menu footer.
  "white_label",
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

// starter grants none of the gated features; every gate is a pro gate. Kept as
// a map rather than a boolean so a middle tier can be added without touching
// the call sites.
const GRANTS: Record<Plan, ReadonlySet<PlanFeature>> = {
  starter: new Set<PlanFeature>(),
  pro: new Set<PlanFeature>(PLAN_FEATURES),
};

// Two is the floor that still demonstrates the feature: one language isn't
// "multi-language", and the switcher wouldn't even render.
export const STARTER_LOCALE_LIMIT = 2;

// Owner + 10. A mid-size restaurant runs 1-2 managers, a cashier, 3-5 waiters
// and 1-2 kitchen, so this never binds in practice — but it leaves room for a
// larger tier later. A cap can always be raised as a gift; lowering one costs
// customers.
export const PRO_STAFF_LIMIT = 10;

export function planAllows(plan: Plan, feature: PlanFeature): boolean {
  return GRANTS[plan].has(feature);
}

/** Active staff rows allowed, not counting the owner. */
export function staffLimit(plan: Plan): number {
  return planAllows(plan, "staff") ? PRO_STAFF_LIMIT : 0;
}

/** Languages the menu may be offered in. */
export function localeLimit(plan: Plan): number {
  return planAllows(plan, "languages")
    ? Number.POSITIVE_INFINITY
    : STARTER_LOCALE_LIMIT;
}

export function isPlan(value: string): value is Plan {
  return (PLANS as readonly string[]).includes(value);
}

type PlanSource = Pick<
  Restaurant,
  "plan" | "plan_expires_at" | "trial_status" | "trial_ends_at"
>;

// What the restaurant is on right now. Never read `restaurant.plan` directly:
// a paid plan past its expiry is a starter, and a restaurant still inside its
// trial is a pro whatever the column says.
export function effectivePlan(r: PlanSource, now: Date = new Date()): Plan {
  const t = now.getTime();

  const paidUntil = r.plan_expires_at ? Date.parse(r.plan_expires_at) : null;
  // A null expiry means no end date has been set, not "expired".
  if (r.plan === "pro" && (paidUntil === null || paidUntil > t)) return "pro";

  // The trial runs as pro so an owner feels the ordering system before paying.
  // needs_review is included because publishing is blocked separately and a
  // hotel under review is meant to keep building.
  const trialEnds = Date.parse(r.trial_ends_at);
  if (
    (r.trial_status === "active" || r.trial_status === "needs_review") &&
    Number.isFinite(trialEnds) &&
    trialEnds > t
  ) {
    return "pro";
  }

  return "starter";
}

export const PLAN_LABELS: Record<Plan, string> = {
  starter: "Starter",
  pro: "Pro",
};

// Shown when a gate is hit. Phrased as what they'd gain, not what they lack.
export const UPGRADE_PROMPTS: Record<PlanFeature, string> = {
  ordering: "Take orders at the table with the Pro plan.",
  staff: "Add waiters, cashiers and kitchen logins with the Pro plan.",
  schedules: "Run breakfast, lunch and dinner menus with the Pro plan.",
  languages: `Offer more than ${STARTER_LOCALE_LIMIT} languages with the Pro plan.`,
  white_label: "Remove fast_menu branding with the Pro plan.",
};
