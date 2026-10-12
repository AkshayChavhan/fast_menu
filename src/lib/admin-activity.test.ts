import { describe, it, expect } from "vitest";

import {
  activityStatus,
  attentionItems,
  buildDashboard,
  entitlementEndsAt,
  istDate,
  lastActivityAt,
  lifecycle,
  restaurantView,
  setupSteps,
  summarize,
  type ActivityRow,
} from "@/lib/admin-activity";
import { PLAN_GRACE_DAYS } from "@/lib/plans";

const NOW = new Date("2026-10-12T06:30:00Z");
const DAY = 24 * 60 * 60 * 1000;

// An instant relative to NOW: at(-3) is three days ago, at(0.5) twelve hours on.
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

// A paying Pro restaurant in the middle of its term, set up and taking orders.
// Each test overrides only what it is about.
const row = (o: Partial<ActivityRow> = {}): ActivityRow => ({
  restaurant_id: "r1",
  name: "Busy Bhojnalaya",
  slug: "busy-bhojnalaya",
  city: "Nagpur",
  phone: "+919800000001",
  owner_email: "owner@example.com",
  created_at: at(-90),
  plan: "pro",
  plan_expires_at: at(200),
  effective_plan: "pro",
  is_live: true,
  is_published: true,
  trial_status: "active",
  trial_ends_at: at(-75),
  ordering_enabled: true,
  kds_enabled: true,
  has_review_link: true,
  dish_count: 40,
  dish_photo_count: 30,
  table_count: 12,
  staff_count: 5,
  last_menu_edit_at: at(-20),
  orders_7d: 50,
  orders_prev_7d: 45,
  orders_30d: 200,
  guest_orders_30d: 150,
  last_order_at: at(-0.1),
  last_payment_status: "paid",
  last_payment_at: at(-165),
  paid_this_month_paise: 0,
  ...o,
});

// On the free trial, nothing paid.
const trial = (daysLeft: number, o: Partial<ActivityRow> = {}) =>
  row({
    plan: "starter",
    plan_expires_at: null,
    trial_status: "active",
    trial_ends_at: at(daysLeft),
    created_at: at(daysLeft - 15),
    last_payment_status: null,
    last_payment_at: null,
    ...o,
  });

// The term ended `daysAgo` days ago and nothing replaced it.
const lapsed = (daysAgo: number, o: Partial<ActivityRow> = {}) =>
  row({
    plan_expires_at: at(-daysAgo),
    effective_plan: "starter",
    is_live: daysAgo < PLAN_GRACE_DAYS,
    ...o,
  });

const kinds = (rows: ActivityRow[]) => attentionItems(rows, NOW).map((i) => i.kind);

describe("lifecycle", () => {
  it("reads a paid term as the tier that was bought", () => {
    expect(lifecycle(row(), NOW)).toBe("pro");
    expect(lifecycle(row({ plan: "starter", effective_plan: "starter" }), NOW)).toBe("starter");
  });

  it("reads a claimed trial with nothing paid as a trial", () => {
    expect(lifecycle(trial(10), NOW)).toBe("trial");
    expect(lifecycle(trial(10, { trial_status: "needs_review" }), NOW)).toBe("trial");
  });

  it("prefers the paid term while a trial is still running", () => {
    expect(lifecycle(row({ trial_ends_at: at(5) }), NOW)).toBe("pro");
  });

  it("falls back to a live trial when the paid term has ended", () => {
    expect(lifecycle(row({ plan_expires_at: at(-1), trial_ends_at: at(5) }), NOW)).toBe("trial");
  });

  it("does not count a trial that was never claimed or was refused", () => {
    const base = { plan_expires_at: null, trial_ends_at: at(10), is_live: false };
    expect(lifecycle(row({ ...base, trial_status: "pending" }), NOW)).toBe("not_started");
    expect(lifecycle(row({ ...base, trial_status: "denied" }), NOW)).toBe("not_started");
  });

  it("splits an ended term by whether guests can still open the menu", () => {
    expect(lifecycle(lapsed(3), NOW)).toBe("grace");
    expect(lifecycle(lapsed(45), NOW)).toBe("dark");
    expect(lifecycle(trial(-2), NOW)).toBe("grace");
    // Ended and never published: there is no menu to keep up.
    expect(lifecycle(lapsed(3, { is_published: false, is_live: false }), NOW)).toBe("dark");
  });
});

describe("entitlementEndsAt", () => {
  it("is the later of the paid term and a claimed trial", () => {
    expect(entitlementEndsAt(row())?.toISOString()).toBe(at(200));
    expect(entitlementEndsAt(trial(4))?.toISOString()).toBe(at(4));
  });

  it("is null when nothing was ever granted", () => {
    expect(entitlementEndsAt(row({ plan_expires_at: null, trial_status: "pending" }))).toBeNull();
  });
});

describe("activityStatus", () => {
  it("is active with an order in the last week", () => {
    expect(activityStatus(row(), NOW)).toBe("active");
  });

  it("is active on a menu edit alone, which is all a Starter restaurant can show", () => {
    const starter = row({
      plan: "starter",
      effective_plan: "starter",
      orders_7d: 0,
      orders_prev_7d: 0,
      orders_30d: 0,
      guest_orders_30d: 0,
      last_order_at: null,
      last_menu_edit_at: at(-2),
    });
    expect(activityStatus(starter, NOW)).toBe("active");
  });

  it("is quiet once nothing has happened for more than a week", () => {
    const idle = { orders_7d: 0, orders_prev_7d: 3, last_order_at: at(-10) };
    expect(activityStatus(row(idle), NOW)).toBe("quiet");
    expect(
      activityStatus(row({ ...idle, last_order_at: null, last_menu_edit_at: null }), NOW),
    ).toBe("quiet");
  });

  it("is lapsed once the term has ended, however busy the floor is", () => {
    expect(activityStatus(lapsed(3), NOW)).toBe("lapsed");
    expect(activityStatus(lapsed(45), NOW)).toBe("lapsed");
  });

  it("is stalled until the menu is published", () => {
    expect(activityStatus(trial(12, { is_published: false, is_live: false }), NOW)).toBe("stalled");
    expect(
      activityStatus(
        row({ plan_expires_at: null, trial_status: "pending", is_published: false, is_live: false }),
        NOW,
      ),
    ).toBe("stalled");
  });

  it("calls an unpublished trial stalled even when it is about to end", () => {
    expect(activityStatus(trial(2, { is_published: false, is_live: false }), NOW)).toBe("stalled");
  });

  it("is at risk when the trial is nearly over and nothing is paid", () => {
    expect(activityStatus(trial(4), NOW)).toBe("at_risk");
    expect(activityStatus(trial(5), NOW)).toBe("at_risk");
    expect(activityStatus(trial(6), NOW)).toBe("active");
  });

  it("is at risk inside the renewal window of a paid term", () => {
    expect(activityStatus(row({ plan_expires_at: at(20) }), NOW)).toBe("at_risk");
    expect(activityStatus(row({ plan_expires_at: at(40) }), NOW)).toBe("active");
  });

  it("is at risk when a busy week is followed by half the orders", () => {
    expect(activityStatus(row({ orders_prev_7d: 12, orders_7d: 6 }), NOW)).toBe("at_risk");
    expect(activityStatus(row({ orders_prev_7d: 12, orders_7d: 7 }), NOW)).toBe("active");
  });

  it("does not read a slow week at a small place as a drop", () => {
    expect(activityStatus(row({ orders_prev_7d: 8, orders_7d: 2 }), NOW)).toBe("active");
  });

  it("is at risk when someone pays for Pro and takes no orders for a fortnight", () => {
    const silent = { orders_7d: 0, orders_prev_7d: 0, last_order_at: at(-30) };
    expect(activityStatus(row(silent), NOW)).toBe("at_risk");
    // Starter has no ordering to use.
    expect(
      activityStatus(row({ ...silent, plan: "starter", effective_plan: "starter" }), NOW),
    ).toBe("quiet");
    // Too new to judge.
    expect(
      activityStatus(row({ ...silent, created_at: at(-5), last_menu_edit_at: at(-1) }), NOW),
    ).toBe("active");
  });
});

describe("lastActivityAt", () => {
  it("is the later of the last order and the last menu edit", () => {
    expect(lastActivityAt(row())?.toISOString()).toBe(at(-0.1));
    expect(lastActivityAt(row({ last_order_at: at(-9), last_menu_edit_at: at(-2) }))?.toISOString()).toBe(
      at(-2),
    );
    expect(lastActivityAt(row({ last_order_at: null, last_menu_edit_at: null }))).toBeNull();
  });
});

describe("istDate", () => {
  it("prints the day as it falls in India", () => {
    expect(istDate("2026-10-08T06:30:00Z")).toBe("08 Oct 2026");
    // 20:00 UTC is already the next morning in India.
    expect(istDate("2026-09-30T20:00:00Z")).toBe("01 Oct 2026");
    expect(istDate("2026-12-31T18:29:59Z")).toBe("31 Dec 2026");
    expect(istDate("2026-12-31T18:30:00Z")).toBe("01 Jan 2027");
  });

  it("spells September the same way everywhere", () => {
    expect(istDate("2026-09-15T06:30:00Z")).toBe("15 Sep 2026");
  });

  it("prints a dash for no date or a bad one", () => {
    expect(istDate(null)).toBe("—");
    expect(istDate("not a date")).toBe("—");
  });
});

describe("attentionItems", () => {
  it("leaves a healthy restaurant alone", () => {
    expect(attentionItems([row()], NOW)).toEqual([]);
  });

  it("says when a lapsed menu goes dark", () => {
    const [item] = attentionItems([lapsed(3)], NOW);
    expect(item.kind).toBe("in_grace");
    expect(item.message).toBe("Plan ended 3 days ago. The menu goes dark in 27 days.");
    expect(item.phone).toBe("+919800000001");
  });

  it("stops chasing a restaurant that has already gone dark", () => {
    expect(kinds([lapsed(45)])).toEqual([]);
  });

  it("counts down a trial with nothing paid", () => {
    const message = (daysLeft: number) => attentionItems([trial(daysLeft)], NOW)[0]?.message;
    expect(message(3)).toBe("Trial ends in 3 days and nothing is paid yet.");
    expect(message(1)).toBe("Trial ends tomorrow and nothing is paid yet.");
    // NOW is noon in India, so five hours on is still today there.
    expect(message(0.2)).toBe("Trial ends today and nothing is paid yet.");
    // 23:00 UTC is already tomorrow morning in India.
    expect(message(0.7)).toBe("Trial ends tomorrow and nothing is paid yet.");
    expect(message(8)).toBeUndefined();
  });

  it("does not chase a trial that has already paid", () => {
    expect(kinds([row({ trial_ends_at: at(2) })])).toEqual([]);
  });

  it("flags a recent failed payment and forgets an old one", () => {
    const failed = (daysAgo: number) =>
      row({ last_payment_status: "failed", last_payment_at: at(-daysAgo) });
    const [item] = attentionItems([failed(2)], NOW);
    expect(item.kind).toBe("payment_failed");
    expect(item.message).toBe("Their last payment attempt failed, 2 days ago.");
    expect(kinds([failed(20)])).toEqual([]);
  });

  it("treats a checkout as abandoned only after an hour", () => {
    const open = (hoursAgo: number) =>
      trial(10, { last_payment_status: "created", last_payment_at: at(-hoursAgo / 24) });
    expect(kinds([open(0.5)])).toEqual([]);
    const [item] = attentionItems([open(3)], NOW);
    expect(item.kind).toBe("checkout_abandoned");
    expect(item.message).toBe("Started paying today and did not finish.");
  });

  it("gives notice of a renewal", () => {
    const [item] = attentionItems([row({ plan_expires_at: at(12) })], NOW);
    expect(item.kind).toBe("plan_expiring");
    expect(item.message).toBe("Paid plan ends in 12 days.");
  });

  it("puts numbers on a drop in orders", () => {
    const [item] = attentionItems([row({ orders_prev_7d: 40, orders_7d: 9 })], NOW);
    expect(item.kind).toBe("usage_drop");
    expect(item.message).toBe("Orders fell from 40 to 9 in a week.");
  });

  it("flags Pro that is paid for and unused", () => {
    const [item] = attentionItems(
      [row({ orders_7d: 0, orders_prev_7d: 0, last_order_at: null })],
      NOW,
    );
    expect(item.kind).toBe("no_orders");
    expect(item.message).toBe("Paying for Pro, but no orders in 14 days.");
  });

  it("flags a draft menu once sign-up is more than three days old", () => {
    const draft = (ageDays: number) =>
      trial(15 - ageDays, { is_published: false, is_live: false });
    expect(kinds([draft(2)])).toEqual([]);
    const [item] = attentionItems([draft(6)], NOW);
    expect(item.kind).toBe("not_published");
    expect(item.message).toBe("Signed up 6 days ago and the menu is still a draft.");
  });

  it("sends a claim under review to the review queue, not the draft list", () => {
    const pending = trial(12, {
      trial_status: "needs_review",
      is_published: false,
      is_live: false,
      created_at: at(-6),
    });
    expect(kinds([pending])).toEqual(["trial_review"]);
  });

  it("flags a sign-up that never started the trial, but not one that was refused", () => {
    const never = (trial_status: "pending" | "denied") =>
      row({
        plan_expires_at: null,
        trial_status,
        trial_ends_at: at(8),
        is_published: false,
        is_live: false,
        effective_plan: "starter",
        created_at: at(-7),
        last_payment_status: null,
        last_payment_at: null,
      });
    const [item] = attentionItems([never("pending")], NOW);
    expect(item.kind).toBe("trial_not_started");
    expect(item.message).toBe("Signed up 7 days ago and never started the trial.");
    expect(kinds([never("denied")])).toEqual([]);
  });

  it("lists one restaurant under every reason that applies", () => {
    const messy = trial(2, {
      is_published: false,
      is_live: false,
      created_at: at(-13),
      last_payment_status: "failed",
      last_payment_at: at(-1),
    });
    expect(kinds([messy])).toEqual(["trial_ending", "payment_failed", "not_published"]);
  });

  it("orders by how soon money is lost, then by urgency within a reason", () => {
    const items = attentionItems(
      [
        trial(4, { restaurant_id: "t4", name: "Trial four" }),
        row({ restaurant_id: "renew", name: "Renewal", plan_expires_at: at(10) }),
        lapsed(20, { restaurant_id: "g20", name: "Grace twenty" }),
        trial(1, { restaurant_id: "t1", name: "Trial one" }),
        lapsed(2, { restaurant_id: "g2", name: "Grace two" }),
      ],
      NOW,
    );
    expect(items.map((i) => i.restaurantId)).toEqual(["g20", "g2", "t1", "t4", "renew"]);
  });
});

describe("setupSteps", () => {
  it("asks a Pro restaurant for the floor setup as well", () => {
    const steps = setupSteps(row());
    expect(steps.map((s) => s.key)).toEqual([
      "published",
      "dishes",
      "photos",
      "review",
      "tables",
      "staff",
      "ordering",
      "kitchen",
    ]);
    expect(steps.every((s) => s.done)).toBe(true);
    expect(steps.map((s) => s.label)).toEqual([
      "Published",
      "40 dishes",
      "30 with photos",
      "Google review link",
      "12 tables",
      "5 staff",
      "Ordering on",
      "Kitchen screen",
    ]);
  });

  it("does not mark Starter down for features it does not have", () => {
    const steps = setupSteps(row({ plan: "starter", effective_plan: "starter" }));
    expect(steps.map((s) => s.key)).toEqual(["published", "dishes", "photos", "review"]);
  });

  it("names what is missing on an empty restaurant", () => {
    const steps = setupSteps(
      row({
        is_published: false,
        dish_count: 0,
        dish_photo_count: 0,
        table_count: 0,
        staff_count: 0,
        ordering_enabled: false,
        kds_enabled: false,
        has_review_link: false,
      }),
    );
    expect(steps.some((s) => s.done)).toBe(false);
    expect(steps.map((s) => s.label)).toEqual([
      "Published",
      "Dishes",
      "Photos",
      "Google review link",
      "Tables",
      "Staff logins",
      "Ordering on",
      "Kitchen screen",
    ]);
  });

  it("counts a single dish and a single table in the singular", () => {
    const labels = setupSteps(row({ dish_count: 1, dish_photo_count: 0, table_count: 1 })).map(
      (s) => s.label,
    );
    expect(labels).toContain("1 dish");
    expect(labels).toContain("1 table");
  });
});

describe("restaurantView", () => {
  it("carries the share of orders guests placed themselves", () => {
    expect(restaurantView(row(), NOW).guestSharePct).toBe(75);
    expect(
      restaurantView(row({ orders_30d: 0, guest_orders_30d: 0 }), NOW).guestSharePct,
    ).toBeNull();
  });

  it("says when a lapsed menu goes dark, and only then", () => {
    const view = restaurantView(lapsed(3), NOW);
    expect(view.lifecycle).toBe("grace");
    expect(view.status).toBe("lapsed");
    expect(view.endsAt).toBe(at(-3));
    expect(view.darkAt).toBe(at(PLAN_GRACE_DAYS - 3));
    expect(restaurantView(row(), NOW).darkAt).toBeNull();
    expect(restaurantView(lapsed(45), NOW).darkAt).toBeNull();
  });

  it("counts the setup steps that are done", () => {
    const view = restaurantView(row({ kds_enabled: false, has_review_link: false }), NOW);
    expect(view.setup).toHaveLength(8);
    expect(view.setupDone).toBe(6);
  });
});

describe("summarize", () => {
  const rows = [
    row({ restaurant_id: "a", paid_this_month_paise: 500000 }),
    row({ restaurant_id: "b", plan_expires_at: at(12), paid_this_month_paise: 200000 }),
    row({ restaurant_id: "c", plan: "starter", effective_plan: "starter", last_menu_edit_at: at(-1) }),
    trial(3, { restaurant_id: "d" }),
    trial(11, { restaurant_id: "e", created_at: at(-4) }),
    trial(13, { restaurant_id: "f", is_published: false, is_live: false, created_at: at(-2) }),
    lapsed(5, { restaurant_id: "g" }),
    lapsed(50, { restaurant_id: "h" }),
    row({
      restaurant_id: "i",
      plan_expires_at: null,
      trial_status: "pending",
      is_published: false,
      is_live: false,
      effective_plan: "starter",
      created_at: at(-1),
    }),
    row({ restaurant_id: "j", orders_7d: 0, orders_prev_7d: 2, last_order_at: at(-9) }),
  ];
  const summary = summarize(rows, NOW);

  it("counts restaurants and how many guests can reach", () => {
    expect(summary.total).toBe(10);
    expect(summary.live).toBe(7);
  });

  it("splits them by where they are with us", () => {
    expect(summary.byLifecycle).toEqual({
      trial: 3,
      starter: 1,
      pro: 3,
      grace: 1,
      dark: 1,
      not_started: 1,
    });
  });

  it("splits them by whether they are using it", () => {
    expect(summary.byStatus).toEqual({
      active: 3,
      quiet: 1,
      at_risk: 2,
      stalled: 2,
      lapsed: 2,
    });
  });

  it("counts what is about to end", () => {
    expect(summary.trialsEnding).toBe(1);
    expect(summary.plansExpiring).toBe(1);
  });

  it("adds up what restaurants paid this month and who is new", () => {
    expect(summary.paidThisMonthPaise).toBe(700000);
    expect(summary.signupsThisWeek).toBe(3);
  });

  it("is all zeros with no restaurants", () => {
    const empty = summarize([], NOW);
    expect(empty.total).toBe(0);
    expect(Object.values(empty.byLifecycle).every((n) => n === 0)).toBe(true);
    expect(Object.values(empty.byStatus).every((n) => n === 0)).toBe(true);
  });
});

describe("buildDashboard", () => {
  it("returns plain data a server component can hand to a client one", () => {
    const data = buildDashboard([row(), trial(2), lapsed(4)], NOW);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    expect(data.restaurants).toHaveLength(3);
    expect(data.summary.total).toBe(3);
    expect(data.attention.map((i) => i.kind)).toEqual(["in_grace", "trial_ending"]);
  });
});
