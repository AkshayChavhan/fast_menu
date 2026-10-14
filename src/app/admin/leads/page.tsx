import type { Metadata } from "next";
import Link from "next/link";
import { PhoneCall } from "lucide-react";

import { requireAdmin } from "@/app/admin/lib";
import { AdminNav } from "@/components/admin/AdminNav";
import { CityActions } from "@/components/admin/leads/CityActions";
import { CityPicker } from "@/components/admin/leads/CityPicker";
import { leadsHref, type PickerState } from "@/lib/leads/href";
import { LeadList, type LeadRow } from "@/components/admin/leads/LeadList";
import {
  getLeadCities,
  getLeadStates,
  LeadGeoPendingMigration,
  type CityWithCount,
  type LeadState,
} from "@/lib/leads/geo-cache";
import {
  bucketFor,
  filterCities,
  formatPopulation,
  isPopulationBucket,
  type LeadCity,
} from "@/lib/leads/types";

export const metadata: Metadata = {
  title: "Leads — fast_menu",
  robots: { index: false, follow: false },
};

// Platform-operator page: restaurants we might sell to, by state, district
// and city, and the log of every call made to them. Same gate as the rest of
// /admin — only emails in platform_admins get in, everyone else sees a 404.
//
// Every filter is a search param so the page is a plain server render and
// a caller can bookmark the slice they are working through.
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, role } = await requireAdmin("/admin/leads");

  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === "string" && v ? v : undefined;
  };
  const rawBucket = one("bucket");
  const sortByRating = one("sort") === "rating";
  const picked: PickerState = {
    state: one("state"),
    district: one("district"),
    city: one("city"),
    bucket: rawBucket && isPopulationBucket(rawBucket) ? rawBucket : undefined,
  };

  // Today in the operator's clock, as YYYY-MM-DD, for "due" and "overdue".
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // Geography and counts come from a ten-minute cache the lead actions clear;
  // only the revisit list and the chosen city's leads are read live.
  const [statesLoaded, cities, dueRes] = await Promise.all([
    loadStates(),
    picked.state ? getLeadCities(picked.state) : picked.bucket === "metro" ? getLeadCities(null) : [],
    supabase
      .from("leads")
      .select("*, lead_cities(name, state)")
      .not("revisit_at", "is", null)
      .lte("revisit_at", todayIso)
      .not("status", "in", "(won,not_interested)")
      .order("revisit_at", { ascending: true })
      .limit(50),
  ]);
  if (dueRes.error) throw new Error(`Failed to load revisits: ${dueRes.error.message}`);

  const due = (dueRes.data ?? []) as LeadRow[];
  const { states, pendingMigration } = statesLoaded;

  // Until lead_geo_summary() exists on the database, the states come from
  // the live query as before and the page says which migration is pending.
  async function loadStates(): Promise<{ states: LeadState[]; pendingMigration: string | null }> {
    try {
      return { states: await getLeadStates(), pendingMigration: null };
    } catch (e) {
      if (!(e instanceof LeadGeoPendingMigration)) throw e;
      const { data, error } = await supabase.rpc("list_lead_states");
      if (error) throw new Error(`Failed to load states: ${error.message}`);
      return { states: (data ?? []) as LeadState[], pendingMigration: e.migration };
    }
  }

  const city = picked.city ? cities.find((c) => c.id === picked.city) ?? null : null;
  const visibleCities = filterCities(cities, {
    district: picked.district,
    bucket: picked.bucket,
  });

  let leads: LeadRow[] = [];
  if (city) {
    let q = supabase.from("leads").select("*").eq("city_id", city.id);
    q = sortByRating
      ? q.order("google_rating", { ascending: false, nullsFirst: false })
          .order("google_review_count", { ascending: false, nullsFirst: false })
      : q.order("status", { ascending: true });
    const { data, error } = await q.order("name", { ascending: true }).limit(1000);
    if (error) throw new Error(`Failed to load leads: ${error.message}`);
    leads = (data ?? []) as LeadRow[];
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <div className="flex items-center gap-2 text-brand-600">
            <PhoneCall className="h-5 w-5" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wide">Platform admin</span>
            <AdminNav current="leads" role={role} />
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Leads</h1>
          <p className="text-sm text-neutral-500">
            Restaurants to call, by city, and what happened when we did. The
            starting list comes from OpenStreetMap, which is thin outside the
            metros and rarely records a phone or website; add the rest as you
            find them.
          </p>
        </div>

        {due.length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">
              Due for a revisit{" "}
              <span className="font-normal text-neutral-500">({due.length})</span>
            </h2>
            <LeadList leads={due} label="Due for a revisit" showCity todayIso={todayIso} />
          </section>
        ) : null}

        {pendingMigration ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            A database migration is pending: <code>{pendingMigration}</code>. The page works; once
            it is applied, the state and city lists come from a cache instead of a live query.
          </p>
        ) : null}

        <CityPicker states={states} cities={cities} picked={picked} />

        {city ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {city.name}
                  <span className="ml-2 text-sm font-normal text-neutral-500">
                    {[city.district, city.state].filter(Boolean).join(", ")}
                  </span>
                </h2>
                <p className="text-xs text-neutral-500">
                  Population {formatPopulation(city.population)}
                  {city.is_metro ? " · metro" : ""} · {leads.length} on the list
                  {leads.length ? ` · ${leads.filter((l) => l.status !== "new").length} reached` : ""}
                  {leads.length > 1 ? (
                    <>
                      {" · "}
                      <Link
                        href={leadsHref({ ...picked, sort: sortByRating ? undefined : "rating" })}
                        className="underline"
                      >
                        {sortByRating ? "Sort by status" : "Sort by Google rating"}
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              <CityActions
                city={city}
                leadCount={leads.length}
                canReplace={role === "project_owner"}
              />
            </div>
            <LeadList leads={leads} label={`Leads in ${city.name}`} todayIso={todayIso} />
          </section>
        ) : picked.state || picked.bucket ? (
          <CityGrid cities={visibleCities} picked={picked} />
        ) : (
          <StateGrid states={states} />
        )}
      </div>
    </main>
  );
}

function CityGrid({ cities, picked }: { cities: CityWithCount[]; picked: PickerState }) {
  if (cities.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
        No city in the list matches that. Try a wider size bucket.
      </p>
    );
  }
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">
        {cities.length} {cities.length === 1 ? "city" : "cities"}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {cities.map((c) => (
          <li key={c.id}>
            <Link
              href={leadsHref({ ...picked, state: c.state, city: c.id })}
              className="block rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:border-brand-400 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-neutral-500">{formatPopulation(c.population)}</span>
              </div>
              <div className="text-xs text-neutral-500">
                {[c.district, picked.state ? null : c.state].filter(Boolean).join(", ") || " "}
              </div>
              <div className="mt-1 text-xs">
                {c.lead_count > 0 ? (
                  <span className="text-brand-700 dark:text-brand-300">{c.lead_count} on the list</span>
                ) : (
                  <span className="text-neutral-400">Not started · {bucketLabel(c)}</span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function bucketLabel(c: LeadCity): string {
  switch (bucketFor(c)) {
    case "metro":
      return "metro";
    case "under_1l":
      return "under 1 lakh";
    case "1l_3l":
      return "1–3 lakh";
    case "3l_5l":
      return "3–5 lakh";
    case "over_5l":
      return "over 5 lakh";
    default:
      return "size unknown";
  }
}

function StateGrid({
  states,
}: {
  states: { state: string; city_count: number; lead_count: number }[];
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Pick a state to start</h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {states.map((s) => (
          <li key={s.state}>
            <Link
              href={leadsHref({ state: s.state })}
              className="flex items-baseline justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:border-brand-400 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <span className="font-medium">{s.state}</span>
              <span className="text-xs text-neutral-500">
                {s.city_count} {s.city_count === 1 ? "city" : "cities"}
                {s.lead_count ? ` · ${s.lead_count} leads` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
