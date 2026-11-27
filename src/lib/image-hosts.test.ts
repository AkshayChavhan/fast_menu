import { describe, it, expect } from "vitest";
import { isImageLink, isOptimizedImageUrl } from "@/lib/image-hosts";

describe("isOptimizedImageUrl", () => {
  it("optimizes our own storage and the demo images", () => {
    expect(
      isOptimizedImageUrl("https://abc.supabase.co/storage/v1/object/public/menu-images/r1/a.jpg"),
    ).toBe(true);
    expect(isOptimizedImageUrl("https://images.unsplash.com/photo-1?w=800")).toBe(true);
  });

  it("leaves every other host alone", () => {
    expect(isOptimizedImageUrl("https://example.com/dosa.jpg")).toBe(false);
    // A look-alike host, a bare suffix, the wrong path, plain http.
    expect(isOptimizedImageUrl("https://evilsupabase.co/storage/v1/object/public/x.jpg")).toBe(false);
    expect(isOptimizedImageUrl("https://supabase.co/storage/v1/object/public/x.jpg")).toBe(false);
    expect(isOptimizedImageUrl("https://abc.supabase.co/auth/v1/x.jpg")).toBe(false);
    expect(isOptimizedImageUrl("http://images.unsplash.com/photo-1")).toBe(false);
    expect(isOptimizedImageUrl("not a url")).toBe(false);
  });
});

describe("isImageLink", () => {
  it("takes https links only", () => {
    expect(isImageLink("https://example.com/dosa.jpg")).toBe(true);
    expect(isImageLink("http://example.com/dosa.jpg")).toBe(false);
    expect(isImageLink("javascript:alert(1)")).toBe(false);
    expect(isImageLink("data:image/png;base64,AAAA")).toBe(false);
    expect(isImageLink("example.com/dosa.jpg")).toBe(false);
    expect(isImageLink("")).toBe(false);
  });
});
