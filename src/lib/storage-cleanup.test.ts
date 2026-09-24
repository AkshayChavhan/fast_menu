import { describe, it, expect, vi, beforeEach } from "vitest";

import { removeRestaurantImages, type ImageStore } from "@/lib/storage-cleanup";

const BASE = "https://abc.supabase.co/storage/v1/object/public/menu-images/";
const RID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

let removed: string[][];
let failWith: string | null;

const store: ImageStore = {
  storage: {
    from: () => ({
      remove: async (paths: string[]) => {
        removed.push(paths);
        return { error: failWith ? { message: failWith } : null };
      },
    }),
  },
};

beforeEach(() => {
  removed = [];
  failWith = null;
});

describe("removeRestaurantImages()", () => {
  it("removes the old files, once each, and leaves the kept one alone", async () => {
    const old = `${BASE}${RID}/logo/old.jpg`;
    const next = `${BASE}${RID}/logo/new.jpg`;
    await removeRestaurantImages(store, RID, [old, old, next, null, undefined], next);
    expect(removed).toEqual([[`${RID}/logo/old.jpg`]]);
  });

  it("never touches another restaurant's folder or an external image", async () => {
    await removeRestaurantImages(store, RID, [
      `${BASE}${OTHER}/logo/x.jpg`,
      "https://images.unsplash.com/photo-1",
    ]);
    expect(removed).toEqual([]);
  });

  it("does nothing when there is nothing to remove", async () => {
    await removeRestaurantImages(store, RID, [null], null);
    expect(removed).toEqual([]);
  });

  it("warns instead of throwing when storage refuses", async () => {
    failWith = "permission denied";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      removeRestaurantImages(store, RID, [`${BASE}${RID}/a.jpg`]),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
  });
});
