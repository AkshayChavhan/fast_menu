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

// How long a menu stays readable after the last entitlement ends. QR codes are
// printed and glued to tables, so a failed card must not be a dinner-service
// outage — ordering stops at once, the menu does not. Mirrors plan_grace().
export const PLAN_GRACE_DAYS = 30;
const GRACE_MS = PLAN_GRACE_DAYS * 24 * 60 * 60 * 1000;

function paidTermEnd(r: { plan_expires_at: string | null }): number | null {
  if (!r.plan_expires_at) return null;
  const t = Date.parse(r.plan_expires_at);
  return Number.isFinite(t) ? t : null;
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

  // A null expiry means no paid subscription, not "forever": comping an
  // account is done by setting the date far out, the same idiom the baseline
  // documents for trial_ends_at.
  const paidUntil = paidTermEnd(r);
  if (r.plan === "pro" && paidUntil !== null && paidUntil > t) return "pro";

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

type LiveSource = PlanSource & Pick<Restaurant, "is_published">;

// Is the public menu up? Mirrors restaurant_is_live(). Three states in all:
// entitled (full plan), grace (menu up, plan already dropped to starter so
// ordering is off), and dark.
export function isLive(r: LiveSource, now: Date = new Date()): boolean {
  if (!r.is_published) return false;

  const trialEnds = Date.parse(r.trial_ends_at);
  const ends = Math.max(
    paidTermEnd(r) ?? Number.NEGATIVE_INFINITY,
    Number.isFinite(trialEnds) ? trialEnds : Number.NEGATIVE_INFINITY,
  );
  if (!Number.isFinite(ends)) return false;

  return now.getTime() < ends + GRACE_MS;
}

/** In the window where the menu is up but the subscription has lapsed. */
export function isInGrace(r: LiveSource, now: Date = new Date()): boolean {
  return isLive(r, now) && effectivePlan(r, now) === "starter" && !isPaidNow(r, now);
}

function isPaidNow(r: PlanSource, now: Date): boolean {
  const paid = paidTermEnd(r);
  return paid !== null && paid > now.getTime();
}

