// OpenStreetMap, through the public Overpass API, as a free source of
// restaurants near a city. Coverage in Indian towns is thin and contact
// tags are rare, so the result is a starting list and not a directory:
// "no website tag" means nobody mapped one, which is why an imported row
// starts as website_status "unknown" and never "none".
//
// Overpass asks that automated clients identify themselves and stay well
// under a few requests a minute. One fetch per button press is fine.

import "server-only";

import { searchRadiusMetres, type LeadCity } from "@/lib/leads/types";

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export interface OsmLeadRow {
  osm_ref: string;
  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  cuisine: string | null;
  lat: number | null;
  lon: number | null;
}

// Everything that serves food and might want a menu. Bars and pubs are left
// out: their menu is a drinks list and a different sale.
const AMENITIES = "restaurant|cafe|fast_food|food_court|ice_cream";

export function buildOverpassQuery(lat: number, lon: number, radiusMetres: number): string {
  const around = `(around:${Math.round(radiusMetres)},${lat},${lon})`;
  return [
    "[out:json][timeout:60];",
    `nwr["amenity"~"^(${AMENITIES})$"]${around};`,
    "out tags center;",
  ].join("\n");
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function first(tags: Record<string, string>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = tags[k]?.trim();
    if (v) return v;
  }
  return null;
}

function addressFrom(tags: Record<string, string>): string | null {
  const full = first(tags, "addr:full");
  if (full) return full;
  const parts = [
    first(tags, "addr:housename"),
    first(tags, "addr:housenumber"),
    first(tags, "addr:street"),
    first(tags, "addr:suburb", "addr:neighbourhood"),
    first(tags, "addr:city"),
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(", ") : null;
}

// Keep the rows a caller can use: a name is required, everything else is
// best effort. Unnamed POIs are the majority in small towns and useless on
// a call sheet.
export function parseOverpassElements(elements: unknown): OsmLeadRow[] {
  if (!Array.isArray(elements)) return [];
  const rows: OsmLeadRow[] = [];
  for (const raw of elements as OverpassElement[]) {
    const tags = raw?.tags ?? {};
    const name = first(tags, "name", "name:en");
    if (!name || !raw.type || typeof raw.id !== "number") continue;
    const lat = raw.lat ?? raw.center?.lat ?? null;
    const lon = raw.lon ?? raw.center?.lon ?? null;
    rows.push({
      osm_ref: `${raw.type}/${raw.id}`,
      name,
      phone: first(tags, "phone", "contact:phone", "contact:mobile"),
      website: first(tags, "website", "contact:website", "url"),
      address: addressFrom(tags),
      cuisine: first(tags, "cuisine")?.replace(/;/g, ", ") ?? null,
      lat,
      lon,
    });
  }
  return rows;
}

export class OverpassError extends Error {}

export async function fetchOsmRestaurants(
  city: Pick<LeadCity, "lat" | "lon" | "population" | "is_metro">,
  fetchImpl: typeof fetch = fetch,
): Promise<OsmLeadRow[]> {
  const query = buildOverpassQuery(city.lat, city.lon, searchRadiusMetres(city));
  const res = await fetchImpl(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "fast_menu leads (+https://github.com/rtledgers/fast_menu)",
    },
    body: new URLSearchParams({ data: query }),
    // Overpass can take a while on a big radius; the query's own timeout is 60s.
    signal: AbortSignal.timeout(75_000),
    cache: "no-store",
  });
  if (res.status === 429 || res.status === 504) {
    throw new OverpassError("OpenStreetMap is busy right now. Try again in a minute.");
  }
  if (!res.ok) {
    throw new OverpassError(`OpenStreetMap answered ${res.status}.`);
  }
  const json = (await res.json()) as { elements?: unknown };
  return parseOverpassElements(json.elements);
}
