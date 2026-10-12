import { describe, it, expect } from "vitest";

import {
  buildInsightsView,
  delta,
  hourLabel,
  hourRange,
  niceTicks,
  parseInsights,
  share,
  shortDate,
  weekdayDate,
  weekdayName,
  type Insights,
  type InsightsFormat,
} from "@/lib/insights";

// Exact, locale-free formatting so the assertions read as what they check.
const fmt: InsightsFormat = {
  money: (cents) => `₹${cents / 100}`,
  compactMoney: (cents) => `₹${cents / 100}`,
  number: (n) => String(n),
};

// Thirty days ending Monday 12 Oct 2026, all quiet.
const blankDays = (): Insights["days"] =>
  Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 13 + i));
    return { date: d.toISOString().slice(0, 10), sales_cents: 0, bills: 0, orders: 0 };
  });

const blank = (): Insights => ({
  timezone: "Asia/Kolkata",
  today: "2026-10-12",
  days: blankDays(),
  hours: Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 })),
  weekdays: Array.from({ length: 7 }, (_, i) => ({ dow: i + 1, orders: 0, sales_cents: 0 })),
  top_dishes: [],
  unsold: { count: 0, names: [] },
  addons: [],
  mix: { guest: 0, waiter: 0, dine_in: 0, takeaway: 0 },
  floor: { tables_total: 0, tables_occupied: 0, open_bills: 0, open_cents: 0 },
});

// A restaurant with a normal month behind it.
const busy = (): Insights => {
  const doc = blank();
  doc.days[29] = { date: "2026-10-12", sales_cents: 450000, bills: 9, orders: 14 };
  doc.days[28] = { date: "2026-10-11", sales_cents: 900000, bills: 20, orders: 31 };
  doc.days[22] = { date: "2026-10-05", sales_cents: 300000, bills: 6, orders: 20 };
  doc.hours[13] = { hour: 13, orders: 12 };
  doc.hours[20] = { hour: 20, orders: 30 };
  doc.hours[21] = { hour: 21, orders: 23 };
  doc.weekdays[0] = { dow: 1, orders: 34, sales_cents: 750000 };
  doc.weekdays[6] = { dow: 7, orders: 31, sales_cents: 900000 };
  doc.top_dishes = [
    { name: "Paneer Tikka", quantity: 40, revenue_cents: 1280000 },
    { name: "Dal Makhani", quantity: 10, revenue_cents: 240000 },
  ];
  doc.unsold = { count: 2, names: ["Boondi Raita", "Mango Lassi"] };
  doc.addons = [
    { name: "Extra butter", count: 18 },
    { name: "Extra chutney", count: 6 },
  ];
  doc.mix = { guest: 45, waiter: 20, dine_in: 60, takeaway: 5 };
  doc.floor = { tables_total: 12, tables_occupied: 5, open_bills: 4, open_cents: 320000 };
  return doc;
};

describe("parseInsights", () => {
  it("accepts the document the database returns", () => {
    expect(parseInsights(busy())).toEqual(busy());
  });

  it("refuses anything else rather than rendering half a page", () => {
    expect(parseInsights(null)).toBeNull();
    expect(parseInsights({})).toBeNull();
    expect(parseInsights({ ...busy(), hours: [] })).toBeNull();
    expect(parseInsights({ ...busy(), days: busy().days.slice(0, 3) })).toBeNull();
    expect(parseInsights({ ...busy(), today: "12/10/2026" })).toBeNull();
  });
});

describe("dates and hours", () => {
  it("reads a calendar date without shifting it through a timezone", () => {
    expect(shortDate("2026-10-12")).toBe("12 Oct");
    expect(weekdayDate("2026-10-12")).toBe("Mon 12 Oct");
    expect(weekdayDate("2026-01-01")).toBe("Thu 1 Jan");
    expect(weekdayName("2026-10-05")).toBe("Monday");
  });

  it("writes hours the way a restaurant says them", () => {
    expect(hourLabel(0)).toBe("12 am");
    expect(hourLabel(9)).toBe("9 am");
    expect(hourLabel(12)).toBe("12 pm");
    expect(hourLabel(19)).toBe("7 pm");
  });

  it("names an hour by where it starts and ends", () => {
    expect(hourRange(13)).toBe("1–2 pm");
    expect(hourRange(0)).toBe("12–1 am");
    expect(hourRange(11)).toBe("11 am–12 pm");
    expect(hourRange(23)).toBe("11 pm–12 am");
  });
});

describe("share and delta", () => {
  it("gives a whole percent, and nothing when there is no total", () => {
    expect(share(45, 65)).toBe(69);
    expect(share(0, 65)).toBe(0);
    expect(share(0, 0)).toBeNull();
  });

  it("says which way a number moved and by how much", () => {
    expect(delta(450, 300)).toEqual({ pct: 50, direction: "up" });
    expect(delta(150, 300)).toEqual({ pct: 50, direction: "down" });
    expect(delta(300, 300)).toEqual({ pct: 0, direction: "flat" });
    expect(delta(0, 300)).toEqual({ pct: 100, direction: "down" });
  });

  it("has nothing to say when last week was zero", () => {
    expect(delta(450, 0)).toBeNull();
    expect(delta(0, 0)).toBeNull();
  });
});

describe("niceTicks", () => {
  it("picks round steps that reach the largest value", () => {
    expect(niceTicks(212)).toEqual([0, 100, 200, 300]);
    expect(niceTicks(34)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(900000)).toEqual([0, 500000, 1000000]);
    expect(niceTicks(8)).toEqual([0, 2, 4, 6, 8]);
  });

  it("never puts a tick at half an order", () => {
    expect(niceTicks(1)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
  });

  it("still gives an axis when everything is zero", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe("buildInsightsView", () => {
  const view = buildInsightsView(busy(), fmt);

  it("compares today with the same weekday last week", () => {
    expect(view.todayLabel).toBe("Mon 12 Oct");
    expect(view.tiles.map((t) => t.label)).toEqual([
      "Sales today",
      "Orders today",
      "Average bill today",
      "Tables occupied now",
    ]);
    const [sales, orders] = view.tiles;
    expect(sales.value).toBe("₹4500");
    expect(sales.delta).toEqual({ pct: 50, direction: "up" });
    expect(sales.hint).toBe("₹3000 last Monday");
    expect(orders.value).toBe("14");
    expect(orders.delta).toEqual({ pct: 30, direction: "down" });
    expect(orders.hint).toBe("20 last Monday");
  });

  it("works out the average bill and reads the floor", () => {
    const [, , average, tables] = view.tiles;
    expect(average.value).toBe("₹500");
    expect(average.hint).toBe("across 9 paid bills");
    expect(tables.value).toBe("5 of 12");
    expect(tables.hint).toBe("₹3200 on 4 open bills");
  });

  it("sums the thirty days in one line", () => {
    // 16,500 / 35 = 471.428…, rounded to the paisa.
    expect(view.monthSummary).toBe("₹16500 from 35 bills, ₹471.43 a bill on average");
  });

  it("draws one column per day and labels one a week, ending on today", () => {
    expect(view.daily.points).toHaveLength(30);
    expect(view.daily.points.filter((p) => p.axisLabel).map((p) => p.axisLabel)).toEqual([
      "14 Sep",
      "21 Sep",
      "28 Sep",
      "5 Oct",
      "12 Oct",
    ]);
    const sunday = view.daily.points[28];
    expect(sunday).toMatchObject({
      title: "Sun 11 Oct",
      value: 900000,
      valueLabel: "₹9000",
      detail: "20 bills · 31 orders",
      peak: true,
    });
    expect(view.daily.points.filter((p) => p.peak)).toHaveLength(1);
    expect(view.daily.ticks).toEqual([
      { value: 0, label: "₹0" },
      { value: 500000, label: "₹5000" },
      { value: 1000000, label: "₹10000" },
    ]);
  });

  it("shows only the hours the restaurant is busy in, with a quiet hour either side", () => {
    expect(view.hours.points.map((p) => p.key)).toEqual(
      ["12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22"],
    );
    expect(view.peakHour).toBe("8–9 pm");
    expect(view.hours.points.find((p) => p.peak)).toMatchObject({
      title: "8–9 pm",
      valueLabel: "30 orders",
    });
    expect(view.hours.points[0].axisLabel).toBe("12 pm");
    expect(view.hours.points[1].axisLabel).toBe("");
    expect(view.hours.ticks.map((t) => t.value)).toEqual([0, 10, 20, 30]);
  });

  it("names the busiest weekday", () => {
    expect(view.weekdays.points.map((p) => p.axisLabel)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(view.peakWeekday).toBe("Monday");
    expect(view.weekdays.points[0]).toMatchObject({
      valueLabel: "34 orders",
      detail: "₹7500 in sales",
    });
  });

  it("ranks dishes against the best seller", () => {
    expect(view.topDishes).toEqual([
      { name: "Paneer Tikka", value: 40, pct: 100, valueLabel: "40 sold", detail: "₹12800" },
      { name: "Dal Makhani", value: 10, pct: 25, valueLabel: "10 sold", detail: "₹2400" },
    ]);
    expect(view.addons.map((a) => [a.name, a.pct, a.valueLabel])).toEqual([
      ["Extra butter", 100, "18 added"],
      ["Extra chutney", 33, "6 added"],
    ]);
  });

  it("splits orders by who placed them and where they were eaten", () => {
    expect(view.source).toEqual([
      { label: "Guests, on their phones", value: 45, pct: 69, valueLabel: "45 orders" },
      { label: "Waiters", value: 20, pct: 31, valueLabel: "20 orders" },
    ]);
    expect(view.service.map((p) => [p.label, p.pct])).toEqual([
      ["Dine in", 92],
      ["Parcel", 8],
    ]);
  });

  it("lists what nobody ordered", () => {
    expect(view.unsold).toEqual({ count: 2, names: ["Boondi Raita", "Mango Lassi"], more: 0 });
  });

  it("names a dozen unsold dishes and counts the rest", () => {
    const doc = busy();
    doc.unsold = { count: 30, names: Array.from({ length: 12 }, (_, i) => `Dish ${i}`) };
    const { unsold } = buildInsightsView(doc, fmt);
    expect(unsold.names).toHaveLength(12);
    expect(unsold.more).toBe(18);
  });

  it("is plain data a server component can hand to a client one", () => {
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});

describe("buildInsightsView with nothing to show", () => {
  const view = buildInsightsView(blank(), fmt);

  it("knows the restaurant has not started", () => {
    expect(view.hasActivity).toBe(false);
  });

  it("has no deltas, peaks or averages to invent", () => {
    expect(view.tiles.every((t) => t.delta === null)).toBe(true);
    expect(view.tiles[2].value).toBe("—");
    expect(view.tiles[2].hint).toBe("no bills paid yet today");
    expect(view.tiles[3].hint).toBe("no open bills");
    expect(view.peakHour).toBeNull();
    expect(view.peakWeekday).toBeNull();
    expect(view.daily.points.some((p) => p.peak)).toBe(false);
    expect(view.monthSummary).toBe("No bills settled in the last 30 days");
  });

  it("still draws a sensible default window of hours", () => {
    expect(view.hours.points[0].key).toBe("9");
    expect(view.hours.points[view.hours.points.length - 1].key).toBe("22");
    expect(view.hours.ticks.map((t) => t.value)).toEqual([0, 1]);
  });

  it("counts an open bill as activity, before anything has been paid", () => {
    const doc = blank();
    doc.floor = { tables_total: 4, tables_occupied: 1, open_bills: 1, open_cents: 12000 };
    expect(buildInsightsView(doc, fmt).hasActivity).toBe(true);
  });

  it("uses the singular for one of anything", () => {
    const doc = blank();
    doc.days[29] = { date: "2026-10-12", sales_cents: 50000, bills: 1, orders: 1 };
    doc.mix = { guest: 1, waiter: 0, dine_in: 1, takeaway: 0 };
    doc.floor = { tables_total: 4, tables_occupied: 1, open_bills: 1, open_cents: 12000 };
    const one = buildInsightsView(doc, fmt);
    expect(one.tiles[2].hint).toBe("across 1 paid bill");
    expect(one.tiles[3].hint).toBe("₹120 on 1 open bill");
    expect(one.daily.points[29].detail).toBe("1 bill · 1 order");
    expect(one.source[0].valueLabel).toBe("1 order");
  });
});
