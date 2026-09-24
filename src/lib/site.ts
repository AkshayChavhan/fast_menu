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

export function publicMenuPath(slug: string): string {
  return `/m/${slug}`;
}

// The per-table QR target. The token, not the label, goes in the URL so a
// renamed table keeps its printed code.
export function tableMenuPath(slug: string, qrToken: string): string {
  return `/m/${slug}?t=${encodeURIComponent(qrToken)}`;
}
