// The leads page's URL, from its filters. Plain module, no "use client":
// server pages build links with it and the picker calls it from the browser.

import type { PopulationBucket } from "@/lib/leads/types";

export interface PickerState {
  state?: string;
  district?: string;
  city?: string;
  bucket?: PopulationBucket;
}

export function leadsHref(next: PickerState): string {
  const p = new URLSearchParams();
  if (next.state) p.set("state", next.state);
  if (next.district) p.set("district", next.district);
  if (next.city) p.set("city", next.city);
  if (next.bucket) p.set("bucket", next.bucket);
  const q = p.toString();
  return q ? `/admin/leads?${q}` : "/admin/leads";
}
