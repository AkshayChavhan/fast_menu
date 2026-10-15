// A welcome video is either a file in our bucket or a YouTube link. The one
// column holds either; these tell them apart and keep a pasted YouTube URL
// to one canonical form, so the same video never looks like two.

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

// The eleven-character id from any of the ways people paste a YouTube link,
// or null for anything else.
export function youtubeIdFromUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (YT_ID.test(raw)) return raw; // just the id, pasted on its own
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      id = m?.[1] ?? null;
    }
  }
  return id && YT_ID.test(id) ? id : null;
}

export function canonicalYoutubeUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function isYoutubeUrl(url: string | null | undefined): boolean {
  return youtubeIdFromUrl(url) !== null;
}

// The privacy-enhanced player, set up as decoration: silent, looping, no
// controls or keyboard, inline on phones. YouTube still shows its own logo
// and may show a title or an ad; a file in our bucket never does.
export function youtubeEmbedUrl(id: string): string {
  const p = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    loop: "1",
    playlist: id, // loop only works with a playlist of the same video
    controls: "0",
    disablekb: "1",
    playsinline: "1",
    rel: "0",
    iv_load_policy: "3",
  });
  return `https://www.youtube-nocookie.com/embed/${id}?${p.toString()}`;
}

export function youtubeThumbnailUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
