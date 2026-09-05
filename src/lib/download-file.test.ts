// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { downloadJson, datedFilename } from "@/lib/download-file";

describe("datedFilename", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T18:30:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("stamps the date so successive backups don't collide", () => {
    expect(datedFilename("my-cafe")).toBe("my-cafe-menu-2026-09-05.json");
  });

  it("accepts a custom suffix", () => {
    expect(datedFilename("my-cafe", "backup")).toBe(
      "my-cafe-backup-2026-09-05.json",
    );
  });
});

describe("downloadJson", () => {
  let createdUrls: number;
  let revokedUrls: string[];

  beforeEach(() => {
    createdUrls = 0;
    revokedUrls = [];
    // jsdom implements neither of these.
    URL.createObjectURL = vi.fn(() => `blob:fake-${++createdUrls}`);
    URL.revokeObjectURL = vi.fn((url: string) => void revokedUrls.push(url));
  });

  it("clicks an anchor carrying the filename, then cleans up", () => {
    const clicked: HTMLAnchorElement[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this);
    };

    try {
      downloadJson("menu.json", '{"a":1}');
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("menu.json");
    expect(clicked[0].href).toBe("blob:fake-1");
  });

  it("removes the anchor from the document afterwards", () => {
    HTMLAnchorElement.prototype.click = vi.fn();
    downloadJson("menu.json", "{}");
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });

  it("revokes the object URL so the blob isn't retained", () => {
    HTMLAnchorElement.prototype.click = vi.fn();
    downloadJson("menu.json", "{}");
    expect(revokedUrls).toEqual(["blob:fake-1"]);
  });
});
