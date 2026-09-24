import { describe, it, expect } from "vitest";

import { clockTime, timeAgo } from "@/lib/time";

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
