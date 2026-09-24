import { describe, it, expect } from "vitest";

import {
  clockTime,
  timeAgo,
  isValidTimezone,
  canonicalTimezone,
} from "@/lib/time";

const now = new Date("2026-09-24T10:00:00Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

describe("timeAgo()", () => {
  it("rounds to a human unit", () => {
    expect(timeAgo(ago(10), now)).toBe("just now");
    expect(timeAgo(ago(90), now)).toBe("2 min");
    expect(timeAgo(ago(45 * 60), now)).toBe("45 min");
    expect(timeAgo(ago(3 * 3600), now)).toBe("3 h");
    expect(timeAgo(ago(2 * 86400), now)).toBe("2 d");
  });

  it("never goes negative and tolerates garbage", () => {
    expect(timeAgo(ago(-30), now)).toBe("just now");
    expect(timeAgo("not a date", now)).toBe("");
  });
});

describe("clockTime()", () => {
  it("formats in the restaurant's timezone", () => {
    expect(clockTime("2026-09-24T10:00:00Z", "Asia/Kolkata")).toBe("15:30");
    expect(clockTime("2026-09-24T10:00:00Z", "UTC")).toBe("10:00");
  });
});

describe("isValidTimezone", () => {
  // The bug: "Asia/Kolkata" is the first option in the settings dropdown, but
  // the old check tested membership of Intl.supportedValuesOf("timeZone"),
  // which lists only canonical names — and India's canonical name is
  // "Asia/Calcutta". Saving the offered zone always failed.
  it("accepts an alias the canonical list leaves out", () => {
    expect(Intl.supportedValuesOf("timeZone")).not.toContain("Asia/Kolkata");
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
  });

  it("accepts every zone the settings card pins to the top", () => {
    for (const tz of [
      "Asia/Kolkata",
      "Asia/Dubai",
      "Asia/Singapore",
      "Europe/London",
      "America/New_York",
      "UTC",
    ]) {
      expect(isValidTimezone(tz)).toBe(true);
    }
  });

  it("still accepts canonical names", () => {
    expect(isValidTimezone("Asia/Calcutta")).toBe(true);
  });

  it("rejects anything that isn't a real zone", () => {
    for (const tz of ["", "garbage", "Not/AZone", "Asia/Kolkatta"]) {
      expect(isValidTimezone(tz)).toBe(false);
    }
  });

  // ICU also honours the legacy tzdata abbreviations, so these pass. Harmless
  // here because the field is a dropdown of real zone names — but worth
  // knowing that "IST" is Israel Standard Time in tzdata, not India.
  it("tolerates legacy abbreviations", () => {
    expect(isValidTimezone("IST")).toBe(true);
    expect(isValidTimezone("GMT")).toBe(true);
  });
});

describe("canonicalTimezone", () => {
  it("folds the two names for India together", () => {
    expect(canonicalTimezone("Asia/Kolkata")).toBe(
      canonicalTimezone("Asia/Calcutta"),
    );
  });

  it("returns the input unchanged when it isn't a zone", () => {
    expect(canonicalTimezone("garbage")).toBe("garbage");
  });
});
