"use client";

import { useRouter } from "next/navigation";

import { leadsHref, type PickerState } from "@/lib/leads/href";
import { POPULATION_BUCKETS, type LeadCity } from "@/lib/leads/types";
import { cn } from "@/lib/utils";

const selectClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800";

// State → district → city, with the size buckets as chips. Every choice is a
// URL change, so a caller can bookmark "Nashik district, under 1 lakh" and
// the page re-renders on the server with just that slice.
export function CityPicker({
  states,
  cities,
  picked,
}: {
  states: { state: string; city_count: number; lead_count: number }[];
  // The chosen state's cities, before the district and bucket filters.
  cities: LeadCity[];
  picked: PickerState;
}) {
  const router = useRouter();
  const go = (next: PickerState) => router.push(leadsHref(next));

  const districts = Array.from(
    new Set(cities.map((c) => c.district).filter((d): d is string => d !== null)),
  ).sort();

  const inDistrict = picked.district
    ? cities.filter((c) => c.district === picked.district)
    : cities;

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="grid gap-3 sm:grid-cols-3">
        <label htmlFor="lead-state" className="block text-xs font-medium text-neutral-500">
          State
          <select
            id="lead-state"
            className={cn(selectClass, "mt-1")}
            value={picked.state ?? ""}
            onChange={(e) => go({ state: e.target.value || undefined, bucket: picked.bucket })}
          >
            <option value="">All states</option>
            {states.map((s) => (
              <option key={s.state} value={s.state}>
                {s.state} ({s.city_count})
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="lead-district" className="block text-xs font-medium text-neutral-500">
          District
          <select
            id="lead-district"
            className={cn(selectClass, "mt-1")}
            value={picked.district ?? ""}
            disabled={!picked.state}
            onChange={(e) =>
              go({ state: picked.state, district: e.target.value || undefined, bucket: picked.bucket })
            }
          >
            <option value="">All districts</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="lead-city" className="block text-xs font-medium text-neutral-500">
          City
          <select
            id="lead-city"
            className={cn(selectClass, "mt-1")}
            value={picked.city ?? ""}
            disabled={!picked.state}
            onChange={(e) =>
              go({
                state: picked.state,
                district: picked.district,
                city: e.target.value || undefined,
                bucket: picked.bucket,
              })
            }
          >
            <option value="">Choose a city</option>
            {inDistrict.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        {POPULATION_BUCKETS.map((b) => {
          const active = picked.bucket === b.key;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() =>
                go({
                  // Metros are a fixed eight across the country: clear the
                  // state so they all show, wherever the caller was looking.
                  state: b.key === "metro" && !active ? undefined : picked.state,
                  district: b.key === "metro" && !active ? undefined : picked.district,
                  bucket: active ? undefined : b.key,
                })
              }
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                active
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300",
              )}
              aria-pressed={active}
            >
              {b.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
