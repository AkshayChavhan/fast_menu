// Shapes and vocabularies for the leads pages. The database is the source of
// truth for the allowed values (see supabase/migrations/*_leads.sql); these
// mirror its check constraints so the UI can offer the right options.

export interface LeadCity {
  id: string;
  name: string;
  state: string;
  district: string | null;
  population: number | null;
  lat: number;
  lon: number;
  is_metro: boolean;
}

export const LEAD_STATUSES = [
  "new",
  "reached",
  "interested",
  "demo_booked",
  "trial",
  "won",
  "not_interested",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "Not called yet",
  reached: "Reached",
  interested: "Interested",
  demo_booked: "Demo booked",
  trial: "On trial",
  won: "Signed up",
  not_interested: "Not interested",
};

export const WEBSITE_STATUSES = ["unknown", "has", "none"] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

export const REVISIT_TYPES = ["call", "online_meeting", "demo"] as const;
export type RevisitType = (typeof REVISIT_TYPES)[number];

export const REVISIT_TYPE_LABELS: Record<RevisitType, string> = {
  call: "Call back",
  online_meeting: "Online meeting",
  demo: "Demo",
};

export type LeadSource = "osm" | "manual";

export interface Lead {
  id: string;
  city_id: string;
  name: string;
  source: LeadSource;
  osm_ref: string | null;
  phone: string | null;
  website: string | null;
  website_status: WebsiteStatus;
  address: string | null;
  cuisine: string | null;
  lat: number | null;
  lon: number | null;
  status: LeadStatus;
  assigned_to: string | null;
  pending: string | null;
  revisit_at: string | null; // YYYY-MM-DD
  revisit_type: RevisitType | null;
  restaurant_id: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadNote {
  id: string;
  lead_id: string;
  author: string | null;
  body: string;
  created_at: string;
}

// --- Population buckets -----------------------------------------------------
//
// Written the way the team says them: lakhs, not thousands. "metro" is the
// eight cities flagged in the seed, not a population cut-off, because the
// figures on Wikidata mix city and urban-agglomeration counts.

export const POPULATION_BUCKETS = [
  { key: "metro", label: "Metro cities" },
  { key: "under_1l", label: "Under 1 lakh" },
  { key: "1l_3l", label: "1 to 3 lakh" },
  { key: "3l_5l", label: "3 to 5 lakh" },
  { key: "over_5l", label: "Over 5 lakh" },
  { key: "unknown", label: "Population not recorded" },
] as const;
export type PopulationBucket = (typeof POPULATION_BUCKETS)[number]["key"];

export function isPopulationBucket(value: string): value is PopulationBucket {
  return POPULATION_BUCKETS.some((b) => b.key === value);
}

export function bucketFor(city: Pick<LeadCity, "population" | "is_metro">): PopulationBucket {
  if (city.is_metro) return "metro";
  const p = city.population;
  if (p == null) return "unknown";
  if (p < 100_000) return "under_1l";
  if (p < 300_000) return "1l_3l";
  if (p < 500_000) return "3l_5l";
  return "over_5l";
}

// "12.3 lakh", "45,000", or "—" when Wikidata has nothing.
export function formatPopulation(p: number | null): string {
  if (p == null) return "—";
  if (p >= 10_000_000) return `${(p / 10_000_000).toFixed(1)} crore`;
  if (p >= 100_000) return `${(p / 100_000).toFixed(1)} lakh`;
  return p.toLocaleString("en-IN");
}

export interface CityFilter {
  state?: string;
  district?: string;
  bucket?: PopulationBucket;
}

// Narrow the seed to what the picker is showing. Districts are compared
// exactly; a city with no district is kept only when no district is chosen.
export function filterCities<T extends LeadCity>(cities: T[], f: CityFilter): T[] {
  return cities.filter((c) => {
    if (f.state && c.state !== f.state) return false;
    if (f.district && c.district !== f.district) return false;
    if (f.bucket && bucketFor(c) !== f.bucket) return false;
    return true;
  });
}

// --- Overpass search radius --------------------------------------------------
//
// How far around the city's point to look for restaurants. Metros sprawl;
// a town of fifty thousand is a few kilometres across.

export function searchRadiusMetres(city: Pick<LeadCity, "population" | "is_metro">): number {
  switch (bucketFor(city)) {
    case "metro":
      return 15_000;
    case "over_5l":
      return 10_000;
    case "3l_5l":
    case "1l_3l":
      return 7_000;
    default:
      return 5_000;
  }
}
