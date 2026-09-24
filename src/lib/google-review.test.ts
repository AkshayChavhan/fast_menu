import { describe, it, expect } from "vitest";

import { normalizeGoogleReviewUrl } from "@/lib/google-review";

describe("normalizeGoogleReviewUrl()", () => {
  it("treats an empty box as 'no link'", () => {
    expect(normalizeGoogleReviewUrl("")).toEqual({ ok: true, url: null });
    expect(normalizeGoogleReviewUrl("   ")).toEqual({ ok: true, url: null });
  });

  it("accepts the links Google hands out for reviews", () => {
    for (const link of [
      "https://g.page/r/CaBcDeF/review",
      "https://search.google.com/local/writereview?placeid=ChIJ123",
      "https://www.google.com/maps/place/Hotel+Sai/@18.5,73.8,17z",
      "https://maps.app.goo.gl/abc123",
      "https://goo.gl/maps/xyz",
      "https://maps.google.co.in/?cid=42",
    ]) {
      const res = normalizeGoogleReviewUrl(link);
      expect(res.ok, link).toBe(true);
    }
  });

  it("refuses non-Google hosts, including look-alikes", () => {
    for (const link of [
      "https://example.com/review",
      "https://google.com.evil.io/r",
      "https://notgoogle.com/maps",
      "https://g.page.example.net/r",
    ]) {
      const res = normalizeGoogleReviewUrl(link);
      expect(res.ok, link).toBe(false);
    }
  });

  it("refuses http and non-URLs", () => {
    expect(normalizeGoogleReviewUrl("http://g.page/r/x/review").ok).toBe(false);
    expect(normalizeGoogleReviewUrl("g.page/r/x/review").ok).toBe(false);
    expect(normalizeGoogleReviewUrl("just some words").ok).toBe(false);
  });

  it("normalises the host case", () => {
    const res = normalizeGoogleReviewUrl("https://G.PAGE/r/abc/review");
    expect(res).toEqual({ ok: true, url: "https://g.page/r/abc/review" });
  });
});
