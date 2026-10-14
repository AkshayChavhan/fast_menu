import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import type { LeadCity } from "@/lib/leads/types";

// The leads page's picker — states, then one state's cities — with a lead
// count beside each. Two thousand seven hundred cities that never change
// and counts that change only when someone on the team adds a lead, so
// both are cached for ten minutes and cleared by the actions that change
// them. Read with the server's own key because a cached function has no
// caller to be an admin; every page that calls this has already turned a
// non-admin away.

export const LEAD_GEO_TAG = "lead-geo";
const TEN_MINUTES = 600;

export interface LeadState {
  state: string;
  city_count: number;
  lead_count: number;
}

export type CityWithCount = LeadCity & { lead_count: number };

// Thrown while the migration that adds lead_geo_summary() is still pending
// on the database, so the page can fall back to the live query instead of
// failing — a deploy always lands before the SQL is pasted.
export class LeadGeoPendingMigration extends Error {
  readonly migration = "20260924004100_lead_geo_summary.sql";
}

export function getLeadStates(): Promise<LeadState[]> {
  return unstable_cache(
    async () => {
      const { data, error } = await createAdminClient().rpc("lead_geo_summary");
      if (error?.code === "PGRST202") throw new LeadGeoPendingMigration(error.message);
      if (error) throw new Error(`Failed to load states: ${error.message}`);
      return ((data as { states?: LeadState[] } | null)?.states ?? []) as LeadState[];
    },
    ["lead-states"],
    { tags: [LEAD_GEO_TAG], revalidate: TEN_MINUTES },
  )();
}

// One state's cities, or the eight metros when `state` is null. Either way
// well under the API's thousand-row cap.
export function getLeadCities(state: string | null): Promise<CityWithCount[]> {
  const key = state ?? "__metro__";
  return unstable_cache(
    async () => {
      let q = createAdminClient()
        .from("lead_cities")
        .select("id, name, state, district, population, lat, lon, is_metro, leads(count)")
        .order("name", { ascending: true })
        .limit(1000);
      q = state ? q.eq("state", state) : q.eq("is_metro", true);
      const { data, error } = await q;
      if (error) throw new Error(`Failed to load cities: ${error.message}`);
      const rows = (data ?? []) as (LeadCity & { leads: { count: number }[] })[];
      return rows.map(({ leads, ...c }) => ({ ...c, lead_count: leads?.[0]?.count ?? 0 }));
    },
    ["lead-cities", key],
    { tags: [LEAD_GEO_TAG], revalidate: TEN_MINUTES },
  )();
}

/** A lead was added, imported, removed or moved: the counts changed. */
export function invalidateLeadGeo(): void {
  revalidateTag(LEAD_GEO_TAG, "max");
}
