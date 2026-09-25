import { describe, it, expect } from "vitest";

import {
  candidateEdges,
  fitImageUnder,
  searchFit,
  QUALITY_FLOOR,
} from "@/lib/image-compress";

const MB = 1024 * 1024;

// A stand-in for a JPEG encoder: bytes grow with pixel count and, roughly,
// with the square of the quality setting. `bytesAtBest` is the size a 2048 px
// encode at quality 0.9 would come out at.
function fakeEncoder(bytesAtBest: number, lossless = false) {
  const calls: [number, number][] = [];
  const encode = async (edge: number, quality: number) => {
    calls.push([edge, quality]);
    const pixels = (edge / 2048) ** 2;
    const q = lossless ? 1 : (quality / 0.9) ** 2;
    return { size: Math.round(bytesAtBest * pixels * q) } as Blob;
  };
  return { encode, calls };
}

describe("candidateEdges()", () => {
  it("starts at 2048 for a big photo and never upscales a small one", () => {
    expect(candidateEdges(4032)).toEqual([2048, 1600, 1280, 1024]);
    expect(candidateEdges(1800)).toEqual([1800, 1600, 1280, 1024]);
    expect(candidateEdges(1024)).toEqual([1024]);
    expect(candidateEdges(900)).toEqual([900]);
  });
});

describe("searchFit()", () => {
  it("gives up resolution before it gives up quality", async () => {
    // 2048 px at 0.9 is 1.4 MB; 1600 px at 0.9 is 0.85 MB.
    const { encode, calls } = fakeEncoder(1.4 * MB);
    const fit = await searchFit(encode, { maxBytes: MB, sourceEdge: 4032 });
    expect(fit).toMatchObject({ edge: 1600, quality: 0.9 });
    expect(calls).toEqual([
      [2048, 0.9],
      [1600, 0.9],
    ]);
  });

  it("drops a quality step only once every size at the better one is too big", async () => {
    // 1024 px at 0.9 is 1.05 MB; 2048 px at 0.85 is 3.75 MB; 1024 px at 0.85 is 0.94 MB.
    const { encode, calls } = fakeEncoder(4.2 * MB);
    const fit = await searchFit(encode, { maxBytes: MB, sourceEdge: 4032 });
    expect(fit).toMatchObject({ edge: 1024, quality: 0.85 });
    expect(calls.slice(0, 4).map(([, q]) => q)).toEqual([0.9, 0.9, 0.9, 0.9]);
    expect(calls.slice(4).map(([, q]) => q)).toEqual([0.85, 0.85, 0.85, 0.85]);
  });

  it("uses the 0.7 floor once, at the smallest size, then gives up", async () => {
    // 1024 px at 0.8 is 1.19 MB; at 0.7 it is 0.91 MB.
    const floor = fakeEncoder(6 * MB);
    const fit = await searchFit(floor.encode, { maxBytes: MB, sourceEdge: 4032 });
    expect(fit).toMatchObject({ edge: 1024, quality: QUALITY_FLOOR });
    expect(floor.calls).toHaveLength(13);

    const hopeless = fakeEncoder(20 * MB);
    expect(await searchFit(hopeless.encode, { maxBytes: MB, sourceEdge: 4032 })).toBeNull();
    expect(hopeless.calls).toHaveLength(13);
  });

  it("works the quality ladder alone for an image already at or below 1024 px", async () => {
    const { encode, calls } = fakeEncoder(4.5 * MB);
    const fit = await searchFit(encode, { maxBytes: MB, sourceEdge: 900 });
    // 900 px: 0.87 MB at 0.9 fits straight away.
    expect(fit).toMatchObject({ edge: 900, quality: 0.9 });
    expect(calls).toEqual([[900, 0.9]]);
  });

  it("lossless: one encode per size, stopping early when no size could fit", async () => {
    // 3 MB at 2048 px shrinks with pixel count: 0.75 MB at 1024 px.
    const ok = fakeEncoder(3 * MB, true);
    const fit = await searchFit(ok.encode, { maxBytes: MB, sourceEdge: 4032, lossless: true });
    expect(fit).toMatchObject({ edge: 1024, quality: null });
    expect(ok.calls).toEqual([
      [2048, 1],
      [1600, 1],
      [1280, 1],
      [1024, 1],
    ]);

    // 10 MB at 2048 px would still be 2.5 MB at 1024 px: stop after one try.
    const hopeless = fakeEncoder(10 * MB, true);
    expect(await searchFit(hopeless.encode, { maxBytes: MB, sourceEdge: 4032, lossless: true })).toBeNull();
    expect(hopeless.calls).toEqual([[2048, 1]]);
  });
});

describe("fitImageUnder()", () => {
  it("returns a file under the limit untouched, without decoding it", async () => {
    const file = new File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" });
    expect(await fitImageUnder(file, 100)).toEqual({ changed: false, blob: file });
  });
});
