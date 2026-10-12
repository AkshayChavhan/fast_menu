// The operator dashboard's verdicts.
//
// list_restaurant_activity() (see migrations/*_admin_activity.sql) returns
// facts: counts and timestamps. This module turns them into what an operator
// acts on — is this restaurant active, who needs a call today, how many trials
// are about to end. It lives here rather than in SQL so a threshold can change
// without a migration, and so every rule has a unit test.
//
// Everything is pure and takes `now`, and everything it returns is plain data,
// so the page can compute once on the server and hand the result to a client
// component without the two disagreeing about what time it is.

import { PLAN_GRACE_DAYS, type Plan } from "@/lib/plans";
import type { TrialStatus } from "@/types/db";

/** One row of list_restaurant_activity(). */
export interface ActivityRow {
  restaurant_id: string;
  name: string;
  slug: string;
  city: string | null;
  phone: string | null;
  owner_email: string | null;
  created_at: string;
  plan: Plan;
  plan_expires_at: string | null;
  // What they are on today, and whether guests can open the menu — both as
  // the database sees it, the same values the plans listing shows.
  effective_plan: Plan;
  is_live: boolean;
  is_published: boolean;
  trial_status: TrialStatus;
  trial_ends_at: string;
  ordering_enabled: boolean;
  kds_enabled: boolean;
  has_review_link: boolean;
  dish_count: number;
  dish_photo_count: number;
  table_count: number;
  staff_count: number;
  last_menu_edit_at: string | null;
  // Orders a member of staff accepted. Counts only: takings are the
  // restaurant's own business.
  orders_7d: number;
  orders_prev_7d: number;
  orders_30d: number;
  guest_orders_30d: number;
  last_order_at: string | null;
  last_payment_status: "created" | "paid" | "failed" | null;
  last_payment_at: string | null;
  paid_this_month_paise: number;
}

// --- Thresholds --------------------------------------------------------------

/** An order or a menu edit this recently makes a live restaurant "active". */
export const ACTIVE_WINDOW_DAYS = 7;
/** A trial this close to its end, with nothing paid, needs a call. */
export const TRIAL_ENDING_DAYS = 5;
/** A paid term this close to its end is in its renewal window. */
export const PLAN_EXPIRING_DAYS = 30;
/** Long enough after sign-up that an unpublished menu is stuck, not in progress. */
export const UNPUBLISHED_AFTER_DAYS = 3;
/** A paying Pro restaurant with no orders for this long is likely to cancel. */
export const NO_ORDERS_DAYS = 14;
/** Below this many orders the week before, a fall is noise rather than a drop. */
export const DROP_MIN_ORDERS = 10;
/** A checkout left open this long was abandoned, not in progress. */
export const ABANDONED_CHECKOUT_HOURS = 1;
/** Payment trouble older than this has been dealt with or forgotten. */
export const PAYMENT_ATTENTION_DAYS = 14;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// --- Lifecycle: where they are with us ---------------------------------------

/**
 * trial        inside the free trial, nothing paid
 * starter/pro  inside a paid term, on that tier
 * grace        the term ended; the menu is still up for PLAN_GRACE_DAYS
 * dark         the term ended and guests can no longer open the menu
 * not_started  signed up but never had a trial or a paid term
 */
export type Lifecycle = "trial" | "starter" | "pro" | "grace" | "dark" | "not_started";

export const LIFECYCLES: readonly Lifecycle[] = [
  "trial",
  "starter",
  "pro",
  "grace",
  "dark",
  "not_started",
];

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  trial: "On trial",
  starter: "Starter",
  pro: "Pro",
  grace: "In grace",
  dark: "Gone dark",
  not_started: "Not started",
};

function parse(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function paidUntil(row: ActivityRow): number | null {
  return parse(row.plan_expires_at);
}

// A trial only counts once it was claimed: `pending` and `denied` rows carry a
// trial_ends_at too, but it never entitled them to anything.
function trialUntil(row: ActivityRow): number | null {
  if (row.trial_status !== "active" && row.trial_status !== "needs_review") return null;
  return parse(row.trial_ends_at);
}

/** When the current or most recent entitlement ends, or null if there never was one. */
export function entitlementEndsAt(row: ActivityRow): Date | null {
  const paid = paidUntil(row);
  const trial = trialUntil(row);
  if (paid === null && trial === null) return null;
  return new Date(Math.max(paid ?? Number.NEGATIVE_INFINITY, trial ?? Number.NEGATIVE_INFINITY));
}

export function lifecycle(row: ActivityRow, now: Date): Lifecycle {
  const t = now.getTime();
  const paid = paidUntil(row);
  if (paid !== null && paid > t) return row.plan;

  const trial = trialUntil(row);
  if (trial !== null && trial > t) return "trial";

  if (paid === null && trial === null) return "not_started";
  return row.is_live ? "grace" : "dark";
}

// --- Status: are they using it ------------------------------------------------

/**
 * lapsed    the trial or paid term has ended
 * stalled   never got as far as a published menu
 * at_risk   live, but the term ends soon or the orders have dried up
 * active    live, with an order or a menu edit in the last ACTIVE_WINDOW_DAYS
 * quiet     live, and nothing has happened for longer than that
 */
export type ActivityStatus = "active" | "quiet" | "stalled" | "at_risk" | "lapsed";

export const ACTIVITY_STATUSES: readonly ActivityStatus[] = [
  "active",
  "quiet",
  "at_risk",
  "stalled",
  "lapsed",
];

export const STATUS_LABELS: Record<ActivityStatus, string> = {
  active: "Active",
  quiet: "Quiet",
  at_risk: "At risk",
  stalled: "Stalled setup",
  lapsed: "Lapsed",
};

export const STATUS_HELP: Record<ActivityStatus, string> = {
  active: `Menu is live, with an order or a menu edit in the last ${ACTIVE_WINDOW_DAYS} days.`,
  quiet: `Menu is live, but nothing has happened for more than ${ACTIVE_WINDOW_DAYS} days.`,
  at_risk: `Trial ends within ${TRIAL_ENDING_DAYS} days, paid plan ends within ${PLAN_EXPIRING_DAYS} days, or orders have dropped off.`,
  stalled: "Signed up, but the menu was never published.",
  lapsed: `Trial or plan has ended. The menu stays up for ${PLAN_GRACE_DAYS} days, then goes dark.`,
};

/** The later of the last accepted order and the last menu edit. */
export function lastActivityAt(row: ActivityRow): Date | null {
  const order = parse(row.last_order_at);
  const edit = parse(row.last_menu_edit_at);
  if (order === null && edit === null) return null;
  return new Date(Math.max(order ?? Number.NEGATIVE_INFINITY, edit ?? Number.NEGATIVE_INFINITY));
}

// Day counts are calendar days in India, where the operator and the
// restaurants are: a trial ending at 5 pm ends "today", not "tomorrow". IST
// has no daylight saving, so a fixed offset is exact.
const IST_OFFSET_MS = 5.5 * HOUR_MS;
const istDay = (t: number) => Math.floor((t + IST_OFFSET_MS) / DAY_MS);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "08 Oct 2026", by the Indian calendar; "—" for no date.
 *
 * Spelled out rather than left to Intl: month names differ between runtimes
 * ("Sep" in one, "Sept" in another), and the list that prints these is rendered
 * on the server and again in the browser, which have to agree.
 */
export function istDate(iso: string | null): string {
  const t = parse(iso);
  if (t === null) return "—";
  const d = new Date(t + IST_OFFSET_MS);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function daysUntil(t: number, now: Date): number {
  return Math.max(0, istDay(t) - istDay(now.getTime()));
}

function daysSince(t: number, now: Date): number {
  return Math.max(0, istDay(now.getTime()) - istDay(t));
}

function trialEnding(row: ActivityRow, now: Date): boolean {
  const trial = trialUntil(row);
  return (
    lifecycle(row, now) === "trial" &&
    trial !== null &&
    trial - now.getTime() <= TRIAL_ENDING_DAYS * DAY_MS
  );
}

function planExpiring(row: ActivityRow, now: Date): boolean {
  const life = lifecycle(row, now);
  const paid = paidUntil(row);
  return (
    (life === "starter" || life === "pro") &&
    paid !== null &&
    paid - now.getTime() <= PLAN_EXPIRING_DAYS * DAY_MS
  );
}

// Half or fewer of last week's orders, and last week was busy enough to mean it.
function usageDropped(row: ActivityRow): boolean {
  return row.orders_prev_7d >= DROP_MIN_ORDERS && row.orders_7d * 2 <= row.orders_prev_7d;
}

// Paying for ordering and not using it. Starter has no ordering, and a trial
// this old is already caught by trialEnding.
function paidProWithoutOrders(row: ActivityRow, now: Date): boolean {
  const created = parse(row.created_at);
  return (
    lifecycle(row, now) === "pro" &&
    row.is_published &&
    created !== null &&
    now.getTime() - created > NO_ORDERS_DAYS * DAY_MS &&
    row.orders_7d + row.orders_prev_7d === 0
  );
}

export function activityStatus(row: ActivityRow, now: Date): ActivityStatus {
  const life = lifecycle(row, now);
  if (life === "grace" || life === "dark") return "lapsed";
  if (life === "not_started" || !row.is_published) return "stalled";
  if (
    trialEnding(row, now) ||
    planExpiring(row, now) ||
    usageDropped(row) ||
    paidProWithoutOrders(row, now)
  ) {
    return "at_risk";
  }
  const last = lastActivityAt(row);
  return last !== null && now.getTime() - last.getTime() <= ACTIVE_WINDOW_DAYS * DAY_MS
    ? "active"
    : "quiet";
}

// --- Needs attention ----------------------------------------------------------

// In the order an operator should work through them: customers we are about to
// lose first, people who have not started last.
export const ATTENTION_KINDS = [
  "in_grace",
  "trial_ending",
  "payment_failed",
  "checkout_abandoned",
  "plan_expiring",
  "usage_drop",
  "no_orders",
  "trial_review",
  "not_published",
  "trial_not_started",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export const ATTENTION_LABELS: Record<AttentionKind, string> = {
  in_grace: "Plan lapsed",
  trial_ending: "Trial ending",
  payment_failed: "Payment failed",
  checkout_abandoned: "Checkout abandoned",
  plan_expiring: "Renewal due",
  usage_drop: "Orders dropped",
  no_orders: "No orders",
  trial_review: "Trial review",
  not_published: "Not published",
  trial_not_started: "Trial not started",
};

export interface AttentionItem {
  kind: AttentionKind;
  restaurantId: string;
  name: string;
  phone: string | null;
  message: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// "today", "tomorrow", "in 4 days"
function inDays(n: number): string {
  if (n <= 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n} days`;
}

// "today", "yesterday", "4 days ago"
function daysAgo(n: number): string {
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  return `${n} days ago`;
}

interface Ranked extends AttentionItem {
  // Smaller is more pressing, within one kind.
  urgency: number;
}

function attentionFor(row: ActivityRow, now: Date): Ranked[] {
  const t = now.getTime();
  const life = lifecycle(row, now);
  const out: Ranked[] = [];
  const add = (kind: AttentionKind, message: string, urgency = 0) =>
    out.push({
      kind,
      restaurantId: row.restaurant_id,
      name: row.name,
      phone: row.phone,
      message,
      urgency,
    });

  const ends = entitlementEndsAt(row);
  if (life === "grace" && ends) {
    const ended = ends.getTime();
    const darkIn = daysUntil(ended + PLAN_GRACE_DAYS * DAY_MS, now);
    add(
      "in_grace",
      `Plan ended ${daysAgo(daysSince(ended, now))}. The menu goes dark ${inDays(darkIn)}.`,
      darkIn,
    );
  }

  const trial = trialUntil(row);
  if (trialEnding(row, now) && trial !== null) {
    const left = daysUntil(trial, now);
    add("trial_ending", `Trial ends ${inDays(left)} and nothing is paid yet.`, left);
  }

  const paymentAt = parse(row.last_payment_at);
  if (paymentAt !== null && t - paymentAt <= PAYMENT_ATTENTION_DAYS * DAY_MS) {
    const paymentAge = daysSince(paymentAt, now);
    if (row.last_payment_status === "failed") {
      add(
        "payment_failed",
        `Their last payment attempt failed, ${daysAgo(paymentAge)}.`,
        paymentAge,
      );
    } else if (
      row.last_payment_status === "created" &&
      t - paymentAt > ABANDONED_CHECKOUT_HOURS * HOUR_MS
    ) {
      add(
        "checkout_abandoned",
        `Started paying ${daysAgo(paymentAge)} and did not finish.`,
        paymentAge,
      );
    }
  }

  const paid = paidUntil(row);
  if (planExpiring(row, now) && paid !== null) {
    const left = daysUntil(paid, now);
    add("plan_expiring", `Paid plan ends ${inDays(left)}.`, left);
  }

  if (usageDropped(row) && life !== "grace" && life !== "dark") {
    add(
      "usage_drop",
      `Orders fell from ${row.orders_prev_7d} to ${row.orders_7d} in a week.`,
      row.orders_7d - row.orders_prev_7d,
    );
  }

  if (paidProWithoutOrders(row, now)) {
    add("no_orders", `Paying for Pro, but no orders in ${NO_ORDERS_DAYS} days.`);
  }

  const created = parse(row.created_at);
  const age = created === null ? 0 : daysSince(created, now);
  if (row.trial_status === "needs_review") {
    add("trial_review", "Waiting for you to review their trial claim.", -age);
  } else if (age > UNPUBLISHED_AFTER_DAYS) {
    // Oldest first: they have been stuck longest.
    if (life === "not_started" && row.trial_status === "pending") {
      add(
        "trial_not_started",
        `Signed up ${plural(age, "day")} ago and never started the trial.`,
        -age,
      );
    } else if (!row.is_published && (life === "trial" || life === "starter" || life === "pro")) {
      add(
        "not_published",
        `Signed up ${plural(age, "day")} ago and the menu is still a draft.`,
        -age,
      );
    }
  }

  return out;
}

/** Every reason a restaurant needs a call, most pressing first. */
export function attentionItems(rows: ActivityRow[], now: Date): AttentionItem[] {
  return rows
    .flatMap((row) => attentionFor(row, now))
    .sort(
      (a, b) =>
        ATTENTION_KINDS.indexOf(a.kind) - ATTENTION_KINDS.indexOf(b.kind) ||
        a.urgency - b.urgency ||
        a.name.localeCompare(b.name),
    )
    .map(({ kind, restaurantId, name, phone, message }) => ({
      kind,
      restaurantId,
      name,
      phone,
      message,
    }));
}

// --- Setup progress -----------------------------------------------------------

export interface SetupStep {
  key: string;
  label: string;
  done: boolean;
}

/**
 * How far through setup they are. Tables, staff, ordering and the kitchen
 * screen are Pro features, so a restaurant on Starter is not marked down for
 * lacking them.
 */
export function setupSteps(row: ActivityRow): SetupStep[] {
  const steps: SetupStep[] = [
    { key: "published", label: "Published", done: row.is_published },
    {
      key: "dishes",
      label: row.dish_count > 0 ? `${row.dish_count} ${row.dish_count === 1 ? "dish" : "dishes"}` : "Dishes",
      done: row.dish_count > 0,
    },
    {
      key: "photos",
      label: row.dish_count > 0 ? `${row.dish_photo_count} with photos` : "Photos",
      done: row.dish_photo_count > 0,
    },
    { key: "review", label: "Google review link", done: row.has_review_link },
  ];
  if (row.effective_plan !== "pro") return steps;
  return [
    ...steps,
    {
      key: "tables",
      label: row.table_count > 0 ? plural(row.table_count, "table") : "Tables",
      done: row.table_count > 0,
    },
    {
      key: "staff",
      label: row.staff_count > 0 ? `${row.staff_count} staff` : "Staff logins",
      done: row.staff_count > 0,
    },
    { key: "ordering", label: "Ordering on", done: row.ordering_enabled },
    { key: "kitchen", label: "Kitchen screen", done: row.kds_enabled },
  ];
}

// --- What the page renders ----------------------------------------------------

export interface RestaurantView {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  phone: string | null;
  ownerEmail: string | null;
  createdAt: string;
  lifecycle: Lifecycle;
  status: ActivityStatus;
  effectivePlan: Plan;
  isLive: boolean;
  // When the trial or paid term ends (or ended); null if there never was one.
  endsAt: string | null;
  // In grace only: when the menu stops opening.
  darkAt: string | null;
  trialStatus: TrialStatus;
  setup: SetupStep[];
  setupDone: number;
  orders7d: number;
  orders30d: number;
  // Share of the last 30 days' orders that guests placed themselves, 0–100.
  guestSharePct: number | null;
  lastOrderAt: string | null;
  lastActivityAt: string | null;
}

export function restaurantView(row: ActivityRow, now: Date): RestaurantView {
  const life = lifecycle(row, now);
  const ends = entitlementEndsAt(row);
  const setup = setupSteps(row);
  return {
    id: row.restaurant_id,
    name: row.name,
    slug: row.slug,
    city: row.city,
    phone: row.phone,
    ownerEmail: row.owner_email,
    createdAt: row.created_at,
    lifecycle: life,
    status: activityStatus(row, now),
    effectivePlan: row.effective_plan,
    isLive: row.is_live,
    endsAt: ends ? ends.toISOString() : null,
    darkAt:
      life === "grace" && ends
        ? new Date(ends.getTime() + PLAN_GRACE_DAYS * DAY_MS).toISOString()
        : null,
    trialStatus: row.trial_status,
    setup,
    setupDone: setup.filter((s) => s.done).length,
    orders7d: row.orders_7d,
    orders30d: row.orders_30d,
    guestSharePct:
      row.orders_30d > 0 ? Math.round((row.guest_orders_30d / row.orders_30d) * 100) : null,
    lastOrderAt: row.last_order_at,
    lastActivityAt: lastActivityAt(row)?.toISOString() ?? null,
  };
}

export interface ActivitySummary {
  total: number;
  live: number;
  byLifecycle: Record<Lifecycle, number>;
  byStatus: Record<ActivityStatus, number>;
  trialsEnding: number;
  plansExpiring: number;
  // What restaurants paid us this calendar month, in paise.
  paidThisMonthPaise: number;
  signupsThisWeek: number;
}

export function summarize(rows: ActivityRow[], now: Date): ActivitySummary {
  const byLifecycle = Object.fromEntries(LIFECYCLES.map((l) => [l, 0])) as Record<Lifecycle, number>;
  const byStatus = Object.fromEntries(ACTIVITY_STATUSES.map((s) => [s, 0])) as Record<
    ActivityStatus,
    number
  >;
  const summary: ActivitySummary = {
    total: rows.length,
    live: 0,
    byLifecycle,
    byStatus,
    trialsEnding: 0,
    plansExpiring: 0,
    paidThisMonthPaise: 0,
    signupsThisWeek: 0,
  };

  for (const row of rows) {
    if (row.is_live) summary.live += 1;
    byLifecycle[lifecycle(row, now)] += 1;
    byStatus[activityStatus(row, now)] += 1;
    if (trialEnding(row, now)) summary.trialsEnding += 1;
    if (planExpiring(row, now)) summary.plansExpiring += 1;
    summary.paidThisMonthPaise += row.paid_this_month_paise;
    const created = parse(row.created_at);
    if (created !== null && now.getTime() - created <= 7 * DAY_MS) summary.signupsThisWeek += 1;
  }
  return summary;
}

export interface ActivityDashboardData {
  summary: ActivitySummary;
  attention: AttentionItem[];
  restaurants: RestaurantView[];
}

export function buildDashboard(rows: ActivityRow[], now: Date): ActivityDashboardData {
  return {
    summary: summarize(rows, now),
    attention: attentionItems(rows, now),
    restaurants: rows.map((row) => restaurantView(row, now)),
  };
}
