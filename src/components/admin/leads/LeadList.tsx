import Link from "next/link";
import { Phone } from "lucide-react";

import { StatusBadge, WebsiteCell } from "@/components/admin/leads/StatusBadge";
import { REVISIT_TYPE_LABELS, type Lead } from "@/lib/leads/types";

export type LeadRow = Lead & {
  // Joined for the revisit list, which spans cities.
  lead_cities?: { name: string; state: string } | null;
};

const day = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
    : null;

// Digits only, for a tel: link; the caller sees the number as typed.
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

export function LeadList({
  leads,
  label,
  showCity = false,
  todayIso,
}: {
  leads: LeadRow[];
  // Accessible name for the table; the page shows two at once.
  label: string;
  showCity?: boolean;
  // YYYY-MM-DD in the operator's timezone, for flagging an overdue revisit.
  todayIso: string;
}) {
  if (leads.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
        Nothing here yet. Fetch from OpenStreetMap, or add the first one by hand.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
      <table aria-label={label} className="w-full min-w-[720px] text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
          <tr>
            <th className="px-3 py-2 font-medium">Restaurant</th>
            {showCity ? <th className="px-3 py-2 font-medium">City</th> : null}
            <th className="px-3 py-2 font-medium">Phone</th>
            <th className="px-3 py-2 font-medium">Website</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Revisit</th>
            <th className="px-3 py-2 font-medium">Pending</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 bg-white dark:divide-neutral-800 dark:bg-neutral-950">
          {leads.map((l) => {
            const overdue = l.revisit_at !== null && l.revisit_at < todayIso;
            return (
              <tr key={l.id} className="align-top hover:bg-neutral-50 dark:hover:bg-neutral-900">
                <td className="px-3 py-2">
                  <Link href={`/admin/leads/${l.id}`} className="font-medium hover:underline">
                    {l.name}
                  </Link>
                  <div className="text-xs text-neutral-500">
                    {[l.cuisine, l.address].filter(Boolean).join(" · ") || (
                      <span className="text-neutral-400">
                        {l.source === "osm" ? "From OpenStreetMap" : "Added by hand"}
                      </span>
                    )}
                  </div>
                  {l.restaurant_id ? (
                    <span className="mt-1 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-200">
                      Already a customer
                    </span>
                  ) : null}
                </td>
                {showCity ? (
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
                    {l.lead_cities?.name ?? "—"}
                  </td>
                ) : null}
                <td className="px-3 py-2 whitespace-nowrap">
                  {l.phone ? (
                    <a href={telHref(l.phone)} className="inline-flex items-center gap-1 hover:underline">
                      <Phone className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
                      {l.phone}
                    </a>
                  ) : (
                    <span className="text-xs text-neutral-400">Not recorded</span>
                  )}
                </td>
                <td className="max-w-[12rem] px-3 py-2">
                  <WebsiteCell website={l.website} status={l.website_status} />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={l.status} />
                  {l.assigned_to ? (
                    <div className="mt-1 text-xs text-neutral-500">{l.assigned_to}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {l.revisit_at ? (
                    <span className={overdue ? "font-medium text-red-700 dark:text-red-300" : ""}>
                      {day(l.revisit_at)}
                      {l.revisit_type ? (
                        <span className="block text-xs font-normal text-neutral-500">
                          {REVISIT_TYPE_LABELS[l.revisit_type]}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="max-w-[16rem] px-3 py-2 text-neutral-600 dark:text-neutral-300">
                  {l.pending ? (
                    <span className="line-clamp-2">{l.pending}</span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
