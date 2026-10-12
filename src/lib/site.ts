import { headers } from "next/headers";

// Resolve the site's public origin (protocol + host) for building absolute URLs
// to the public menu / QR target. Prefers an explicit env var, then whatever
// the host advertises (Vercel or Netlify), then the incoming request headers.
// A variable that exists but is blank is not a setting. Treating it as one is
// how `NEXT_PUBLIC_SITE_URL   =` (spaces around the =) silently became a
// different key and sent QR codes to whatever host served the page.
function firstSet(...values: (string | undefined)[]): string | undefined {
  for (const v of values) {
    const trimmed = v?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

// The origin the host advertises, whoever the host is. Exported for tests;
// getSiteOrigin() falls back to the request headers when none of these is set.
export function originFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  // An explicit setting always wins: it is the only one that survives a move
  // between hosts, and the only one safe to print on a QR code.
  const explicit = firstSet(env.NEXT_PUBLIC_SITE_URL);
  if (explicit) return explicit.replace(/\/$/, "");

  // Netlify's URL carries its protocol; Vercel's VERCEL_URL does not.
  const netlify = firstSet(env.URL, env.DEPLOY_PRIME_URL);
  if (netlify) return netlify.replace(/\/$/, "");

  const vercel = firstSet(env.VERCEL_URL);
  if (vercel) return `https://${vercel}`.replace(/\/$/, "");

  return undefined;
}

export async function getSiteOrigin(): Promise<string> {
  const fromEnv = originFromEnv();
  if (fromEnv) return fromEnv;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// Path helpers are re-exported for server callers; client components must
// import them from lib/paths.ts instead, because this module pulls in
// next/headers.
export { publicMenuPath, tableMenuPath } from "./paths";
