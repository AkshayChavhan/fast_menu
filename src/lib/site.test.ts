import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const headersMock = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: headersMock }));

import { getSiteOrigin, publicMenuPath } from "@/lib/site";

// Stand-in for the read-only Headers object next/headers resolves to.
function requestHeaders(map: Record<string, string>) {
  return Promise.resolve({ get: (k: string) => map[k] ?? null });
}

describe("publicMenuPath", () => {
  it("builds the /m/<slug> route", () => {
    expect(publicMenuPath("my-cafe")).toBe("/m/my-cafe");
  });
});

describe("getSiteOrigin", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_URL;
    headersMock.mockReturnValue(requestHeaders({}));
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("prefers an explicit NEXT_PUBLIC_SITE_URL", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://menu.example.com";
    process.env.VERCEL_URL = "ignored.vercel.app";
    await expect(getSiteOrigin()).resolves.toBe("https://menu.example.com");
  });

  it("strips a trailing slash from the env value", async () => {
    // Otherwise every built URL would contain a double slash.
    process.env.NEXT_PUBLIC_SITE_URL = "https://menu.example.com/";
    await expect(getSiteOrigin()).resolves.toBe("https://menu.example.com");
  });

  it("falls back to VERCEL_URL as https", async () => {
    process.env.VERCEL_URL = "preview.vercel.app";
    await expect(getSiteOrigin()).resolves.toBe("https://preview.vercel.app");
  });

  it("uses the forwarded host and protocol behind a proxy", async () => {
    headersMock.mockReturnValue(
      requestHeaders({
        "x-forwarded-host": "menu.example.com",
        "x-forwarded-proto": "https",
        host: "internal:3000",
      }),
    );
    await expect(getSiteOrigin()).resolves.toBe("https://menu.example.com");
  });

  it("assumes http for localhost", async () => {
    headersMock.mockReturnValue(requestHeaders({ host: "localhost:3000" }));
    await expect(getSiteOrigin()).resolves.toBe("http://localhost:3000");
  });

  it("assumes https for a non-localhost host with no proto header", async () => {
    headersMock.mockReturnValue(requestHeaders({ host: "menu.example.com" }));
    await expect(getSiteOrigin()).resolves.toBe("https://menu.example.com");
  });

  it("falls back to localhost when there are no headers at all", async () => {
    await expect(getSiteOrigin()).resolves.toBe("http://localhost:3000");
  });
});
