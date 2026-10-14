import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PhoneCall } from "lucide-react";

import { requireAdmin } from "@/app/admin/lib";
import { AdminNav } from "@/components/admin/AdminNav";
import { LeadDetail } from "@/components/admin/leads/LeadDetail";
import { leadsHref } from "@/components/admin/leads/CityPicker";
import type { Lead, LeadCity, LeadNote } from "@/lib/leads/types";

export const metadata: Metadata = {
  title: "Lead — fast_menu",
  robots: { index: false, follow: false },
};

// One restaurant: its contact details, the call log, and the form for the
// next call. Same gate as /admin/leads.
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { supabase, user, role } = await requireAdmin(`/admin/leads/${id}`);

  const [leadRes, notesRes] = await Promise.all([
    supabase.from("leads").select("*, lead_cities(*)").eq("id", id).maybeSingle(),
    supabase
      .from("lead_notes")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (leadRes.error) throw new Error(`Failed to load lead: ${leadRes.error.message}`);
  if (!leadRes.data) notFound();
  if (notesRes.error) throw new Error(`Failed to load notes: ${notesRes.error.message}`);

  const { lead_cities: city, ...lead } = leadRes.data as Lead & { lead_cities: LeadCity };
  const notes = (notesRes.data ?? []) as LeadNote[];

  let customer: { name: string; slug: string } | null = null;
  if (lead.restaurant_id) {
    const { data } = await supabase
      .from("restaurants")
      .select("name, slug")
      .eq("id", lead.restaurant_id)
      .maybeSingle();
    customer = data ?? null;
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <div className="flex items-center gap-2 text-brand-600">
            <PhoneCall className="h-5 w-5" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wide">Platform admin</span>
            <AdminNav current="leads" role={role} />
          </div>
          <Link
            href={leadsHref({ state: city.state, district: city.district ?? undefined, city: city.id })}
            className="mt-2 inline-flex items-center gap-1 text-xs text-neutral-500 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {city.name}, {city.state}
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{lead.name}</h1>
          <p className="text-sm text-neutral-500">
            {[lead.cuisine, lead.address].filter(Boolean).join(" · ") ||
              (lead.source === "osm" ? "From OpenStreetMap" : "Added by hand")}
          </p>
        </div>

        <LeadDetail
          lead={lead}
          notes={notes}
          customer={customer}
          currentUserEmail={user.email ?? ""}
        />
      </div>
    </main>
  );
}
