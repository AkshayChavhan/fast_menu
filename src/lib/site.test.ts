import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const headersMock = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: headersMock }));

import { getSiteOrigin, originFromEnv, publicMenuPath } from "@/lib/site";

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
    delete process.env.URL;
    delete process.env.DEPLOY_PRIME_URL;
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

// originFromEnv() is the part that has to survive a change of host. Tested
// directly because it takes the environment as an argument, so there is
// nothing to mock and nothing to leak between cases.
describe("originFromEnv", () => {
  const env = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv;

  it("prefers an explicit setting over anything the host says", () => {
    expect(
      originFromEnv(
        env({
          NEXT_PUBLIC_SITE_URL: "https://menu.example.com",
          URL: "https://something.netlify.app",
          VERCEL_URL: "something.vercel.app",
        }),
      ),
    ).toBe("https://menu.example.com");
  });

  // A variable that exists but is blank is not a setting. This is the bug
  // `NEXT_PUBLIC_SITE_URL   =` caused: present, useless, silently ignored, and
  // QR codes quietly pointed at whatever host served the page.
  it("treats a blank or whitespace value as unset", () => {
    expect(
      originFromEnv(env({ NEXT_PUBLIC_SITE_URL: "   ", URL: "https://site.netlify.app" })),
    ).toBe("https://site.netlify.app");
    expect(originFromEnv(env({ NEXT_PUBLIC_SITE_URL: "" }))).toBeUndefined();
  });

  it("reads Netlify's URL, which already carries its protocol", () => {
    expect(originFromEnv(env({ URL: "https://site.netlify.app" }))).toBe(
      "https://site.netlify.app",
    );
  });

  it("reads Vercel's VERCEL_URL, which does not", () => {
    expect(originFromEnv(env({ VERCEL_URL: "app.vercel.app" }))).toBe(
      "https://app.vercel.app",
    );
  });

  it("prefers Netlify's URL over a Vercel leftover", () => {
    expect(
      originFromEnv(env({ URL: "https://site.netlify.app", VERCEL_URL: "old.vercel.app" })),
    ).toBe("https://site.netlify.app");
  });

  it("falls back to a Netlify preview URL", () => {
    expect(
      originFromEnv(env({ DEPLOY_PRIME_URL: "https://deploy--site.netlify.app" })),
    ).toBe("https://deploy--site.netlify.app");
  });

  it("returns undefined when nothing is set, so the caller uses the request host", () => {
    expect(originFromEnv(env({}))).toBeUndefined();
  });
});

