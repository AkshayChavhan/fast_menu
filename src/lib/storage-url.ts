// Where uploaded images live, and the limits every upload shares: the browser
// control checks them before sending, the bucket enforces them
// (migrations/*_image_size_limit.sql), and the docs quote them.
export const IMAGE_BUCKET = "menu-images";
export const IMAGE_MAX_BYTES = 1024 * 1024; // 1 MB
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const PUBLIC_PREFIX = `/storage/v1/object/public/${IMAGE_BUCKET}/`;

// The object path inside the bucket behind one of our public URLs, or null
// for anything else: another bucket, an external image, garbage.
export function imagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const at = pathname.indexOf(PUBLIC_PREFIX);
  if (at === -1) return null;
  let path: string;
  try {
    path = decodeURIComponent(pathname.slice(at + PUBLIC_PREFIX.length));
  } catch {
    return null;
  }
  return path === "" ? null : path;
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
