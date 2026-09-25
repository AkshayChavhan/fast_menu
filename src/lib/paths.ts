// Public URL paths. Pure string helpers, safe to import from client
// components; the server-only origin resolver lives in lib/site.ts.

export function publicMenuPath(slug: string): string {
  return `/m/${slug}`;
}

// The per-table QR target. The token, not the label, goes in the URL so a
// renamed table keeps its printed code.
export function tableMenuPath(slug: string, qrToken: string): string {
  return `/m/${slug}?t=${encodeURIComponent(qrToken)}`;
}
