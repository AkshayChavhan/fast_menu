import { describe, it, expect } from "vitest";

import {
  describeDays,
  isScheduleOpen,
  isSpecial,
  isSpecialActive,
  localClock,
  minutesToTime,
  timeToMinutes,
} from "@/lib/schedule";

// 2026-09-22 is a Tuesday. 03:30 UTC = 09:00 in Asia/Kolkata.
const TUE_0330_UTC = new Date("2026-09-22T03:30:00Z");

describe("localClock()", () => {
  it("reads the weekday, minutes and date in the restaurant's zone", () => {
    expect(localClock(TUE_0330_UTC, "Asia/Kolkata")).toEqual({
      weekday: 2,
      minutes: 9 * 60,
      date: "2026-09-22",
    });
    expect(localClock(TUE_0330_UTC, "UTC")).toEqual({
      weekday: 2,
      minutes: 3 * 60 + 30,
      date: "2026-09-22",
    });
  });

  it("crosses the date line correctly", () => {
    // 23:30 Monday in Los Angeles.
    const clock = localClock(new Date("2026-09-22T06:30:00Z"), "America/Los_Angeles");
    expect(clock).toEqual({ weekday: 1, minutes: 23 * 60 + 30, date: "2026-09-21" });
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(localClock(TUE_0330_UTC, "Mars/Olympus")).toEqual(localClock(TUE_0330_UTC, "UTC"));
  });
});

describe("time helpers", () => {
  it("round-trips", () => {
    expect(timeToMinutes("07:30:00")).toBe(450);
    expect(timeToMinutes("07:30")).toBe(450);
    expect(minutesToTime(450)).toBe("07:30");
    expect(minutesToTime(0)).toBe("00:00");
  });
});

describe("isScheduleOpen()", () => {
  const breakfast = { days: [1, 2, 3, 4, 5], starts_at: "07:00:00", ends_at: "11:00:00", is_active: true };
  const at = (weekday: number, minutes: number) => ({ weekday, minutes, date: "2026-09-22" });

  it("is open inside the window on a listed day", () => {
    expect(isScheduleOpen(breakfast, at(2, 9 * 60))).toBe(true);
  });

  it("closes at the end minute and before the start", () => {
    expect(isScheduleOpen(breakfast, at(2, 11 * 60))).toBe(false);
    expect(isScheduleOpen(breakfast, at(2, 6 * 60 + 59))).toBe(false);
    expect(isScheduleOpen(breakfast, at(2, 7 * 60))).toBe(true);
  });

  it("is closed on days not listed", () => {
    expect(isScheduleOpen(breakfast, at(0, 9 * 60))).toBe(false);
  });

  it("treats a missing or inactive schedule as always open", () => {
    expect(isScheduleOpen(null, at(0, 0))).toBe(true);
    expect(isScheduleOpen({ ...breakfast, is_active: false }, at(0, 0))).toBe(true);
  });

  it("handles an overnight window by its start day", () => {
    const late = { days: [5], starts_at: "22:00:00", ends_at: "02:00:00", is_active: true };
    expect(isScheduleOpen(late, at(5, 23 * 60))).toBe(true); // Friday 23:00
    expect(isScheduleOpen(late, at(6, 1 * 60))).toBe(true); // Saturday 01:00
    expect(isScheduleOpen(late, at(6, 3 * 60))).toBe(false); // Saturday 03:00
    expect(isScheduleOpen(late, at(4, 23 * 60))).toBe(false); // Thursday 23:00
    expect(isScheduleOpen(late, at(5, 1 * 60))).toBe(false); // Friday 01:00 (Thu not listed)
  });
});

describe("specials", () => {
  it("knows which dishes carry a window", () => {
    expect(isSpecial({ special_from: null, special_until: null })).toBe(false);
    expect(isSpecial({ special_from: "2026-09-22", special_until: null })).toBe(true);
  });

  it("is active inside the window, inclusive, and open-ended when a side is null", () => {
    const window = { special_from: "2026-09-20", special_until: "2026-09-22" };
    expect(isSpecialActive(window, "2026-09-19")).toBe(false);
    expect(isSpecialActive(window, "2026-09-20")).toBe(true);
    expect(isSpecialActive(window, "2026-09-22")).toBe(true);
    expect(isSpecialActive(window, "2026-09-23")).toBe(false);
    expect(isSpecialActive({ special_from: null, special_until: "2026-09-22" }, "2026-01-01")).toBe(true);
    expect(isSpecialActive({ special_from: "2026-09-22", special_until: null }, "2027-01-01")).toBe(true);
    expect(isSpecialActive({ special_from: null, special_until: null }, "2026-09-22")).toBe(true);
  });
});

describe("describeDays()", () => {
  it("names common patterns", () => {
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(describeDays([1, 2, 3, 4, 5])).toBe("Mon–Fri");
    expect(describeDays([6, 0])).toBe("Sat, Sun");
    expect(describeDays([5, 6, 0])).toBe("Fri–Sun");
    expect(describeDays([1, 3])).toBe("Mon, Wed");
    expect(describeDays([])).toBe("No days");
  });
});
