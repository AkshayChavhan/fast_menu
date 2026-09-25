import { headers } from "next/headers";

// Resolve the site's public origin (protocol + host) for building absolute URLs
// to the public menu / QR target. Prefers an explicit env var, else infers it
// from the incoming request headers (works behind Vercel/proxies).
export async function getSiteOrigin(): Promise<string> {
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  if (fromEnv) return fromEnv.replace(/\/$/, "");

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
