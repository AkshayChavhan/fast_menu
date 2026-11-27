// The hosts whose images go through Next's image optimizer. next.config.ts
// reads this list for `images.remotePatterns`, and the menu reads it to
// decide per image, so the two can never disagree.
//
// Anything else — a dish photo an owner linked from their own site, say —
// is drawn with `unoptimized`: the browser fetches it straight from that
// host. We do not open remotePatterns to every host, because that turns
// /_next/image into a free resizing proxy for the whole internet and spends
// the hosting plan's optimization quota on it.
export const OPTIMIZED_IMAGE_HOSTS = [
  {
    protocol: "https",
    hostname: "*.supabase.co",
    pathname: "/storage/v1/object/public/**",
  },
  {
    // Demo seed images (supabase/seed.sql).
    protocol: "https",
    hostname: "images.unsplash.com",
  },
] as const satisfies ReadonlyArray<{
  protocol: "https";
  hostname: string;
  pathname?: string;
}>;

function hostMatches(pattern: string, hostname: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".supabase.co"
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === pattern;
}

function pathMatches(pattern: string | undefined, pathname: string): boolean {
  if (!pattern) return true;
  if (pattern.endsWith("/**")) return pathname.startsWith(pattern.slice(0, -2));
  return pathname === pattern;
}

// True when `url` is on a host listed above, so next/image may optimize it.
// False for any other host and for anything that is not a URL.
export function isOptimizedImageUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return OPTIMIZED_IMAGE_HOSTS.some(
    (p) =>
      u.protocol === `${p.protocol}:` &&
      hostMatches(p.hostname, u.hostname) &&
      pathMatches("pathname" in p ? p.pathname : undefined, u.pathname),
  );
}

// A link an owner may paste as a photo: an absolute https URL. http would be
// blocked as mixed content on the https menu, and other schemes are never
// images we want.
export function isImageLink(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname !== "";
  } catch {
    return false;
  }
}
