import { describe, it, expect } from "vitest";

import { codeFromScan, normaliseOrderCode } from "@/lib/order-code";

describe("normaliseOrderCode()", () => {
  it("upper-cases and trims", () => {
    expect(normaliseOrderCode(" k7m2qd ")).toBe("K7M2QD");
  });

  it("rejects anything that isn't 4–8 letters or digits", () => {
    expect(normaliseOrderCode("")).toBeNull();
    expect(normaliseOrderCode("abc")).toBeNull();
    expect(normaliseOrderCode("K7M2-QD")).toBeNull();
    expect(normaliseOrderCode("TOOLONGCODE")).toBeNull();
  });
});

describe("codeFromScan()", () => {
  it("reads the code out of our scan URL", () => {
    expect(codeFromScan("https://fast-menu.app/waiter/scan?code=k7m2qd")).toBe("K7M2QD");
    expect(codeFromScan("http://localhost:3000/waiter/scan?foo=1&code=ABCDEF")).toBe("ABCDEF");
  });

  it("accepts a bare code", () => {
    expect(codeFromScan("ABCDEF")).toBe("ABCDEF");
  });

  it("ignores other URLs and junk", () => {
    expect(codeFromScan("https://example.com/menu")).toBeNull();
    expect(codeFromScan("https://fast-menu.app/waiter/scan?code=")).toBeNull();
    expect(codeFromScan("WIFI:S:cafe;P:secret;;")).toBeNull();
  });
});
