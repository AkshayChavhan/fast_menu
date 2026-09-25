// Menu schedules and daily specials, evaluated in the restaurant's own
// timezone. Mirrors schedule_is_open() and dish_special_active() in the
// database so the public menu, the guest's cart and the order function all
// agree on what is on right now.

import type { Dish, MenuSchedule } from "@/types/db";

export interface LocalClock {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
  /** Local calendar date as YYYY-MM-DD. */
  date: string;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// What time is it at the restaurant? Falls back to UTC for a bad zone so a
// typo in Settings degrades to "always open" rather than a crash.
export function localClock(now: Date, timeZone: string): LocalClock {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now);
  } catch {
    return localClock(now, "UTC");
  }
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return {
    weekday: WEEKDAYS[get("weekday")] ?? 0,
    minutes: hour * 60 + minute,
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

// "07:30:00" or "07:30" → minutes since midnight.
export function timeToMinutes(value: string): number {
  const [h = "0", m = "0"] = value.split(":");
  return (Number(h) % 24) * 60 + (Number(m) % 60);
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type ScheduleWindow = Pick<MenuSchedule, "days" | "starts_at" | "ends_at" | "is_active">;

// Open at `clock`? Inactive schedules never restrict. An overnight window
// (22:00–02:00) belongs to its start day.
export function isScheduleOpen(schedule: ScheduleWindow | null | undefined, clock: LocalClock): boolean {
  if (!schedule || !schedule.is_active) return true;
  const start = timeToMinutes(schedule.starts_at);
  const end = timeToMinutes(schedule.ends_at);
  const days = schedule.days;
  const today = days.includes(clock.weekday);
  if (start <= end) {
    return today && clock.minutes >= start && clock.minutes < end;
  }
  const yesterday = days.includes((clock.weekday + 6) % 7);
  return (today && clock.minutes >= start) || (yesterday && clock.minutes < end);
}

export type SpecialWindow = Pick<Dish, "special_from" | "special_until">;

// Has the admin given this dish a date window at all?
export function isSpecial(dish: SpecialWindow): boolean {
  return dish.special_from !== null || dish.special_until !== null;
}

// Within the window on the restaurant's calendar date? ISO dates compare
// correctly as strings. No window means always active.
export function isSpecialActive(dish: SpecialWindow, date: string): boolean {
  if (dish.special_from && dish.special_from > date) return false;
  if (dish.special_until && dish.special_until < date) return false;
  return true;
}

// "Mon–Fri", "Sat, Sun", "Every day".
export function describeDays(days: number[]): string {
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  if (sorted.length === 0) return "No days";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // Contiguous run within Mon..Sun ordering reads as a range.
  const monFirst = sorted.map((d) => (d + 6) % 7).sort((a, b) => a - b);
  const contiguous = monFirst.every((d, i) => i === 0 || d === monFirst[i - 1] + 1);
  if (contiguous && sorted.length > 2) {
    const first = names[(monFirst[0] + 1) % 7];
    const last = names[(monFirst[monFirst.length - 1] + 1) % 7];
    return `${first}–${last}`;
  }
  return monFirst.map((d) => names[(d + 1) % 7]).join(", ");
}
