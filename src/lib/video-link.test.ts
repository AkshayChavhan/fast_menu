import { describe, it, expect } from "vitest";

import {
  canonicalYoutubeUrl,
  isYoutubeUrl,
  youtubeEmbedUrl,
  youtubeIdFromUrl,
  youtubeThumbnailUrl,
} from "@/lib/video-link";

describe("youtubeIdFromUrl", () => {
  it("reads every way people paste a YouTube link", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&t=12s",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
      "youtube.com/watch?v=dQw4w9WgXcQ",
      " dQw4w9WgXcQ ",
    ]) {
      expect(youtubeIdFromUrl(u), u).toBe("dQw4w9WgXcQ");
    }
  });

  it("refuses anything that is not a YouTube video", () => {
    for (const u of [
      "https://vimeo.com/123456",
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/channel/UCabc",
      "https://www.youtube.com/watch?v=short",
      "not a url",
      "",
      null,
    ]) {
      expect(youtubeIdFromUrl(u), String(u)).toBeNull();
    }
  });
});

describe("the rest", () => {
  it("keeps one canonical form and tells kinds apart", () => {
    expect(canonicalYoutubeUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(isYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isYoutubeUrl("https://x.supabase.co/storage/v1/object/public/menu-videos/r/a.mp4")).toBe(false);
  });

  it("embeds silently, looping, without controls, on the privacy domain", () => {
    const u = new URL(youtubeEmbedUrl("dQw4w9WgXcQ"));
    expect(u.hostname).toBe("www.youtube-nocookie.com");
    expect(u.pathname).toBe("/embed/dQw4w9WgXcQ");
    expect(u.searchParams.get("mute")).toBe("1");
    expect(u.searchParams.get("autoplay")).toBe("1");
    expect(u.searchParams.get("loop")).toBe("1");
    expect(u.searchParams.get("playlist")).toBe("dQw4w9WgXcQ");
    expect(u.searchParams.get("controls")).toBe("0");
    expect(youtubeThumbnailUrl("dQw4w9WgXcQ")).toContain("/vi/dQw4w9WgXcQ/");
  });
});
