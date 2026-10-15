import { describe, it, expect } from "vitest";

import {
  imagePathForRestaurant,
  imagePathFromUrl,
  videoPathForRestaurant,
  videoPathFromUrl,
} from "@/lib/storage-url";

const BASE = "https://abc.supabase.co/storage/v1/object/public/menu-images/";
const RID = "11111111-1111-1111-1111-111111111111";

describe("imagePathFromUrl()", () => {
  it("returns the object path behind a public URL", () => {
    expect(imagePathFromUrl(`${BASE}${RID}/logo/a.jpg`)).toBe(`${RID}/logo/a.jpg`);
  });

  it("decodes URL-encoded segments", () => {
    expect(imagePathFromUrl(`${BASE}${RID}/my%20dish.png`)).toBe(`${RID}/my dish.png`);
  });

  it("ignores other buckets, external images and garbage", () => {
    expect(imagePathFromUrl("https://abc.supabase.co/storage/v1/object/public/other/x.jpg")).toBeNull();
    expect(imagePathFromUrl("https://images.unsplash.com/photo-1")).toBeNull();
    expect(imagePathFromUrl("not a url")).toBeNull();
    expect(imagePathFromUrl(BASE)).toBeNull();
    expect(imagePathFromUrl(null)).toBeNull();
    expect(imagePathFromUrl(undefined)).toBeNull();
  });
});

describe("imagePathForRestaurant()", () => {
  it("accepts files in the restaurant's own folder", () => {
    expect(imagePathForRestaurant(`${BASE}${RID}/staff/s1/p.webp`, RID)).toBe(`${RID}/staff/s1/p.webp`);
  });

  it("refuses another restaurant's folder, even one with a similar prefix", () => {
    expect(imagePathForRestaurant(`${BASE}22222222-2222-2222-2222-222222222222/a.jpg`, RID)).toBeNull();
    expect(imagePathForRestaurant(`${BASE}${RID}0/a.jpg`, RID)).toBeNull();
    expect(imagePathForRestaurant(`${BASE}a.jpg`, RID)).toBeNull();
  });
});


describe("videoPathFromUrl", () => {
  const base = "https://abc.supabase.co/storage/v1/object/public";
  it("reads the menu-videos bucket and nothing else", () => {
    expect(videoPathFromUrl(`${base}/menu-videos/r1/a.mp4`)).toBe("r1/a.mp4");
    expect(videoPathFromUrl(`${base}/menu-images/r1/a.jpg`)).toBeNull();
    expect(videoPathFromUrl("https://example.com/a.mp4")).toBeNull();
    expect(videoPathFromUrl(null)).toBeNull();
  });
  it("keeps a restaurant to its own folder", () => {
    expect(videoPathForRestaurant(`${base}/menu-videos/r1/a.mp4`, "r1")).toBe("r1/a.mp4");
    expect(videoPathForRestaurant(`${base}/menu-videos/r2/a.mp4`, "r1")).toBeNull();
  });
});
