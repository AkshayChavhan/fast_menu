import { describe, it, expect } from "vitest";

import {
  formatBytes,
  GB,
  MB,
  monthsUntilFull,
  percentUsed,
  readInfraConfig,
  toneFor,
} from "@/lib/infra-limits";

describe("readInfraConfig", () => {
  it("reads the plans from the environment", () => {
    const c = readInfraConfig({ HOSTING_PROVIDER: "netlify", HOSTING_PLAN: "free", SUPABASE_PLAN: "pro" });
    expect(c.hosting.provider).toBe("netlify");
    expect(c.hosting.credits?.limit).toBe(300);
    expect(c.supabase.database.limit).toBe(8 * GB);
    expect(c.assumed).toEqual([]);
  });

  it("assumes the cheapest plan and says so when nothing is set", () => {
    const c = readInfraConfig({});
    expect(c.hosting.provider).toBe("vercel");
    expect(c.hosting.plan).toBe("hobby");
    expect(c.hosting.commercialUse).toBe(false);
    expect(c.supabase.plan).toBe("free");
    expect(c.assumed).toHaveLength(3);
  });

  it("detects the host from the host's own variable", () => {
    expect(readInfraConfig({ NETLIFY: "true" }).hosting.provider).toBe("netlify");
    expect(readInfraConfig({ VERCEL: "1" }).hosting.provider).toBe("vercel");
  });

  it("falls back when a plan does not exist for the provider", () => {
    const c = readInfraConfig({ HOSTING_PROVIDER: "netlify", HOSTING_PLAN: "hobby" });
    expect(c.hosting.plan).toBe("free");
    expect(c.assumed[0]).toContain("HOSTING_PLAN");
  });
});

describe("arithmetic", () => {
  it("formats bytes the way the dashboards do", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("2 KB");
    expect(formatBytes(2.5 * MB)).toBe("2.5 MB");
    expect(formatBytes(250 * MB)).toBe("250 MB");
    expect(formatBytes(1.25 * GB)).toBe("1.3 GB");
    expect(formatBytes(100 * GB)).toBe("100 GB");
  });

  it("gives a percentage only when both sides are known", () => {
    expect(percentUsed(250 * MB, 500 * MB)).toBe(50);
    expect(percentUsed(600 * MB, 500 * MB)).toBe(100);
    expect(percentUsed(null, 500)).toBeNull();
    expect(percentUsed(10, null)).toBeNull();
    expect(percentUsed(1, 3)).toBe(33.3);
  });

  it("colours the bands", () => {
    expect(toneFor(null)).toBe("unknown");
    expect(toneFor(10)).toBe("ok");
    expect(toneFor(60)).toBe("warn");
    expect(toneFor(85)).toBe("danger");
  });

  it("projects months until full from the growth rate", () => {
    expect(monthsUntilFull(100 * MB, 500 * MB, 50 * MB)).toBe(8);
    expect(monthsUntilFull(500 * MB, 500 * MB, 50 * MB)).toBe(0);
    expect(monthsUntilFull(100 * MB, 500 * MB, 0)).toBeNull();
    expect(monthsUntilFull(100 * MB, null, 50 * MB)).toBeNull();
    expect(monthsUntilFull(1, 10 * GB, 1)).toBe(120);
  });
});
