// The Google review link an owner pastes into Settings. Guests are sent to it
// after paying, so it must be an https link on a Google-owned host: a
// review shortcut (g.page/r/…/review), a "write a review" search link, a
// Maps place or a Maps short link. Anything else is refused rather than
// silently stored, because a wrong link here sends every guest astray.

const EXACT_HOSTS = new Set(["g.page", "goo.gl", "maps.app.goo.gl"]);

function isGoogleHost(host: string): boolean {
  const h = host.toLowerCase();
  if (EXACT_HOSTS.has(h)) return true;
  // google.com, www.google.com, maps.google.co.in, search.google.com …
  return /(^|\.)google\.[a-z]{2,}(\.[a-z]{2,})?$/.test(h);
}

export type GoogleReviewUrlResult =
  | { ok: true; url: string | null }
  | { ok: false; error: string };

export function normalizeGoogleReviewUrl(input: string): GoogleReviewUrlResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, url: null };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "Paste the full link, starting with https://" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "The review link must start with https://" };
  }
  if (!isGoogleHost(url.hostname)) {
    return {
      ok: false,
      error:
        "That doesn't look like a Google link. Use the 'Get more reviews' link from your Google Business Profile.",
    };
  }
  if (trimmed.length > 500) {
    return { ok: false, error: "That link is too long." };
  }

  return { ok: true, url: url.toString() };
}
