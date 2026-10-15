// Where uploaded images live, and the limits every upload shares: the browser
// control checks them before sending, the bucket enforces them
// (migrations/*_image_size_limit.sql), and the docs quote them.
export const IMAGE_BUCKET = "menu-images";
export const IMAGE_MAX_BYTES = 1024 * 1024; // 1 MB
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

// The welcome-banner video: its own bucket, its own cap. No shrinking in the
// browser for video, so the cap is the whole rule. Fifteen megabytes is
// ten to fifteen seconds of 720p; the control says so.
export const VIDEO_BUCKET = "menu-videos";
export const VIDEO_MAX_BYTES = 15 * 1024 * 1024; // 15 MB
export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm"] as const;

const publicPrefix = (bucket: string) => `/storage/v1/object/public/${bucket}/`;

// The object path inside `bucket` behind one of our public URLs, or null
// for anything else: another bucket, an external file, garbage.
function pathFromUrl(bucket: string, url: string | null | undefined): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const prefix = publicPrefix(bucket);
  const at = pathname.indexOf(prefix);
  if (at === -1) return null;
  let path: string;
  try {
    path = decodeURIComponent(pathname.slice(at + prefix.length));
  } catch {
    return null;
  }
  return path === "" ? null : path;
}

export function imagePathFromUrl(url: string | null | undefined): string | null {
  return pathFromUrl(IMAGE_BUCKET, url);
}

export function videoPathFromUrl(url: string | null | undefined): string | null {
  return pathFromUrl(VIDEO_BUCKET, url);
}

// Every upload goes under `<restaurantId>/…`, so a restaurant may only ever
// delete files in its own folder, whatever URL a client hands us.
export function imagePathForRestaurant(
  url: string | null | undefined,
  restaurantId: string,
): string | null {
  const path = imagePathFromUrl(url);
  return path !== null && path.startsWith(`${restaurantId}/`) ? path : null;
}

export function videoPathForRestaurant(
  url: string | null | undefined,
  restaurantId: string,
): string | null {
  const path = videoPathFromUrl(url);
  return path !== null && path.startsWith(`${restaurantId}/`) ? path : null;
}
