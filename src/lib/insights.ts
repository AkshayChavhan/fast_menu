// What the Insights page shows, worked out from restaurant_insights() (see
// migrations/*_restaurant_insights.sql).
//
// The database does the counting; this module does the reading: today against
// the same day last week, where the busy hours are, which axis ticks to draw.
// It is pure, and everything it returns is plain data with the labels already
// written, so the page can build it once on the server and the chart
// components never format a number or a date themselves — the server's Intl
// and the browser's do not always agree, and a chart that hydrates to a
// different label is a bug nobody can reproduce.

import { z } from "zod";

// --- The document the database returns ---------------------------------------

const count = z.number().int().nonnegative();
const cents = z.number().int().nonnegative();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const insightsSchema = z.object({
  timezone: z.string(),
  today: isoDate,
  days: z.array(z.object({ date: isoDate, sales_cents: cents, bills: count, orders: count })).min(8),
  hours: z.array(z.object({ hour: z.number().int().min(0).max(23), orders: count })).length(24),
  weekdays: z
    .array(z.object({ dow: z.number().int().min(1).max(7), orders: count, sales_cents: cents }))
    .length(7),
  top_dishes: z.array(z.object({ name: z.string(), quantity: count, revenue_cents: cents })),
  unsold: z.object({ count, names: z.array(z.string()) }),
  addons: z.array(z.object({ name: z.string(), count })),
  mix: z.object({ guest: count, waiter: count, dine_in: count, takeaway: count }),
  floor: z.object({
    tables_total: count,
    tables_occupied: count,
    open_bills: count,
    open_cents: cents,
  }),
});

export type Insights = z.infer<typeof insightsSchema>;

/** The RPC result as a typed document, or null if it is not one. */
export function parseInsights(raw: unknown): Insights | null {
  const parsed = insightsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// --- Small pure helpers -------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_FROM_SUNDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG_FROM_SUNDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// A calendar date has no timezone. Reading "2026-10-12" through Date.UTC keeps
// it the 12th wherever the code runs.
function dateParts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { day: d, month: MONTHS[m - 1], weekday };
}

/** "12 Oct" */
export function shortDate(date: string): string {
  const { day, month } = dateParts(date);
  return `${day} ${month}`;
}

/** "Mon 12 Oct" */
export function weekdayDate(date: string): string {
  const { weekday } = dateParts(date);
  return `${WEEKDAYS_FROM_SUNDAY[weekday]} ${shortDate(date)}`;
}

/** "Monday" */
export function weekdayName(date: string): string {
  return WEEKDAYS_LONG_FROM_SUNDAY[dateParts(date).weekday];
}

/** 0 → "12 am", 13 → "1 pm" */
export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "am" : "pm"}`;
}

/** 13 → "1–2 pm", 11 → "11 am–12 pm" */
export function hourRange(hour: number): string {
  const next = (hour + 1) % 24;
  const [from, to] = [hourLabel(hour), hourLabel(next)];
  // "1–2 pm" when both ends share am or pm, "11 am–12 pm" when they do not.
  return hour < 12 === next < 12 ? `${from.split(" ")[0]}–${to}` : `${from}–${to}`;
}

/** Whole percent of `part` in `total`, or null when there is no total. */
export function share(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

export interface Delta {
  /** Whole percent change, always positive; the direction says which way. */
  pct: number;
  direction: "up" | "down" | "flat";
}

/** Change from `previous` to `current`, or null when there is nothing to compare with. */
export function delta(current: number, previous: number): Delta | null {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct: Math.abs(pct), direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

/**
 * Round axis ticks from zero to at least `max`: steps of 1, 2 or 5 times a
 * power of ten, at most `intervals` of them.
 */
export function niceTicks(max: number, intervals = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / intervals;
  const power = 10 ** Math.floor(Math.log10(rough));
  const candidate = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  // These axes count orders and paise, which come whole: never a tick at half
  // an order.
  const step = Math.max(1, candidate);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return ticks;
}

// --- The page's view model ----------------------------------------------------

/** How numbers are written. Supplied by the page so tests can be exact. */
export interface InsightsFormat {
  /** Minor units as a full amount: "₹1,200.00". */
  money: (cents: number) => string;
  /** Minor units for an axis tick: "₹1.2K". */
  compactMoney: (cents: number) => string;
  /** A count: "1,204". */
  number: (n: number) => string;
}

export interface ChartPoint {
  key: string;
  /** Under the column. Empty when this tick is skipped to avoid a crowd. */
  axisLabel: string;
  value: number;
  /** Tooltip and table: what this column is. */
  title: string;
  /** Tooltip and table: its value, written out. */
  valueLabel: string;
  /** On the cap of the tallest column, where there is no room for the long form. */
  shortValue: string;
  /** Tooltip and table: a second fact, if there is one. */
  detail: string;
  /** The tallest column, labelled on its cap. */
  peak: boolean;
}

export interface ChartData {
  points: ChartPoint[];
  ticks: { value: number; label: string }[];
}

export interface RankedRow {
  name: string;
  value: number;
  /** Width of its bar against the longest, 0–100. */
  pct: number;
  valueLabel: string;
  detail: string;
}

export interface SplitPart {
  label: string;
  value: number;
  pct: number;
  valueLabel: string;
}

export interface StatTile {
  label: string;
  value: string;
  /** Against the same weekday last week; null when there is nothing to compare. */
  delta: Delta | null;
  hint: string;
}

export interface InsightsView {
  /** False until the restaurant has an accepted order or a settled bill. */
  hasActivity: boolean;
  todayLabel: string;
  tiles: StatTile[];
  monthSummary: string;
  daily: ChartData;
  hours: ChartData;
  /** "7–8 pm", or null when there are no orders to have a peak. */
  peakHour: string | null;
  weekdays: ChartData;
  peakWeekday: string | null;
  topDishes: RankedRow[];
  unsold: { count: number; names: string[]; more: number };
  addons: RankedRow[];
  source: SplitPart[];
  service: SplitPart[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The index of the largest value, or -1 when everything is zero. Ties go to
// the latest, which on a time axis is the one the reader cares about.
function peakIndex(values: number[]): number {
  let best = -1;
  let bestValue = 0;
  values.forEach((v, i) => {
    if (v > 0 && v >= bestValue) {
      best = i;
      bestValue = v;
    }
  });
  return best;
}

function ticksFor(values: number[], label: (v: number) => string) {
  return niceTicks(Math.max(0, ...values)).map((value) => ({ value, label: label(value) }));
}

function dailyChart(days: Insights["days"], fmt: InsightsFormat): ChartData {
  const sales = days.map((d) => d.sales_cents);
  const peak = peakIndex(sales);
  // A label a week, counted back from today, so each one is the same weekday
  // as today and five of them fit under thirty columns on a phone.
  const last = days.length - 1;
  return {
    points: days.map((d, i) => ({
      key: d.date,
      axisLabel: (last - i) % 7 === 0 ? shortDate(d.date) : "",
      value: d.sales_cents,
      title: weekdayDate(d.date),
      valueLabel: fmt.money(d.sales_cents),
      shortValue: fmt.compactMoney(d.sales_cents),
      detail: `${plural(d.bills, "bill")} · ${plural(d.orders, "order")}`,
      peak: i === peak,
    })),
    ticks: ticksFor(sales, fmt.compactMoney),
  };
}

function hoursChart(hours: Insights["hours"], fmt: InsightsFormat): ChartData {
  const active = hours.filter((h) => h.orders > 0).map((h) => h.hour);
  // Only the part of the day the restaurant is open for, with an hour of quiet
  // on each side so the first and last columns do not sit on the edge.
  const from = active.length ? Math.max(0, Math.min(...active) - 1) : 9;
  const to = active.length ? Math.min(23, Math.max(...active) + 1) : 22;
  const shown = hours.filter((h) => h.hour >= from && h.hour <= to);
  const peak = peakIndex(shown.map((h) => h.orders));
  const every = shown.length > 12 ? 3 : 2;
  return {
    points: shown.map((h, i) => ({
      key: String(h.hour),
      axisLabel: (h.hour - from) % every === 0 ? hourLabel(h.hour) : "",
      value: h.orders,
      title: hourRange(h.hour),
      valueLabel: plural(h.orders, "order"),
      shortValue: fmt.number(h.orders),
      detail: "",
      peak: i === peak,
    })),
    ticks: ticksFor(shown.map((h) => h.orders), fmt.number),
  };
}

const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOW_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function weekdaysChart(weekdays: Insights["weekdays"], fmt: InsightsFormat): ChartData {
  const peak = peakIndex(weekdays.map((w) => w.orders));
  return {
    points: weekdays.map((w, i) => ({
      key: String(w.dow),
      axisLabel: DOW_SHORT[w.dow - 1],
      value: w.orders,
      title: DOW_LONG[w.dow - 1],
      valueLabel: plural(w.orders, "order"),
      shortValue: fmt.number(w.orders),
      detail: `${fmt.money(w.sales_cents)} in sales`,
      peak: i === peak,
    })),
    ticks: ticksFor(weekdays.map((w) => w.orders), fmt.number),
  };
}

function ranked<T>(
  rows: T[],
  read: (row: T) => { name: string; value: number; valueLabel: string; detail: string },
): RankedRow[] {
  const items = rows.map(read);
  const longest = Math.max(0, ...items.map((r) => r.value));
  return items.map((r) => ({ ...r, pct: longest > 0 ? Math.round((r.value / longest) * 100) : 0 }));
}

function split(parts: { label: string; value: number }[], fmt: InsightsFormat): SplitPart[] {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return parts.map((p) => ({
    ...p,
    pct: share(p.value, total) ?? 0,
    valueLabel: `${fmt.number(p.value)} ${p.value === 1 ? "order" : "orders"}`,
  }));
}

const UNSOLD_SHOWN = 12;

// A long menu can have dozens of dishes nobody ordered. Name a dozen and count
// the rest.
function unsoldView(unsold: Insights["unsold"]) {
  const names = unsold.names.slice(0, UNSOLD_SHOWN);
  return { count: unsold.count, names, more: Math.max(0, unsold.count - names.length) };
}

export function buildInsightsView(insights: Insights, fmt: InsightsFormat): InsightsView {
  const { days, floor, mix } = insights;
  const today = days[days.length - 1];
  const lastWeek = days[days.length - 8];
  const lastWeekDay = weekdayName(lastWeek.date);

  const monthSales = days.reduce((n, d) => n + d.sales_cents, 0);
  const monthBills = days.reduce((n, d) => n + d.bills, 0);
  const monthOrders = days.reduce((n, d) => n + d.orders, 0);

  const tiles: StatTile[] = [
    {
      label: "Sales today",
      value: fmt.money(today.sales_cents),
      delta: delta(today.sales_cents, lastWeek.sales_cents),
      hint: `${fmt.money(lastWeek.sales_cents)} last ${lastWeekDay}`,
    },
    {
      label: "Orders today",
      value: fmt.number(today.orders),
      delta: delta(today.orders, lastWeek.orders),
      hint: `${fmt.number(lastWeek.orders)} last ${lastWeekDay}`,
    },
    {
      label: "Average bill today",
      value: today.bills > 0 ? fmt.money(Math.round(today.sales_cents / today.bills)) : "—",
      delta: null,
      hint: today.bills > 0 ? `across ${plural(today.bills, "paid bill")}` : "no bills paid yet today",
    },
    {
      label: "Tables occupied now",
      value: `${floor.tables_occupied} of ${floor.tables_total}`,
      delta: null,
      hint:
        floor.open_bills > 0
          ? `${fmt.money(floor.open_cents)} on ${plural(floor.open_bills, "open bill")}`
          : "no open bills",
    },
  ];

  const hours = hoursChart(insights.hours, fmt);
  const weekdays = weekdaysChart(insights.weekdays, fmt);

  return {
    hasActivity: monthOrders > 0 || monthBills > 0 || floor.open_bills > 0,
    todayLabel: weekdayDate(insights.today),
    tiles,
    monthSummary:
      monthBills > 0
        ? `${fmt.money(monthSales)} from ${plural(monthBills, "bill")}, ${fmt.money(Math.round(monthSales / monthBills))} a bill on average`
        : "No bills settled in the last 30 days",
    daily: dailyChart(days, fmt),
    hours,
    peakHour: hours.points.find((p) => p.peak)?.title ?? null,
    weekdays,
    peakWeekday: weekdays.points.find((p) => p.peak)?.title ?? null,
    topDishes: ranked(insights.top_dishes, (d) => ({
      name: d.name,
      value: d.quantity,
      valueLabel: `${fmt.number(d.quantity)} sold`,
      detail: fmt.money(d.revenue_cents),
    })),
    unsold: unsoldView(insights.unsold),
    addons: ranked(insights.addons, (a) => ({
      name: a.name,
      value: a.count,
      valueLabel: `${fmt.number(a.count)} added`,
      detail: "",
    })),
    source: split(
      [
        { label: "Guests, on their phones", value: mix.guest },
        { label: "Waiters", value: mix.waiter },
      ],
      fmt,
    ),
    service: split(
      [
        { label: "Dine in", value: mix.dine_in },
        { label: "Parcel", value: mix.takeaway },
      ],
      fmt,
    ),
  };
}
