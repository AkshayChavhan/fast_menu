"use server";

import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { fetchOsmRestaurants, OverpassError } from "@/lib/leads/overpass";
import {
  LEAD_STATUSES,
  REVISIT_TYPES,
  WEBSITE_STATUSES,
  type LeadCity,
} from "@/lib/leads/types";
import type { ActionResult } from "@/app/dashboard/lib";

// Every write here is gated twice: the SQL functions and the RLS policies
// check is_platform_admin() themselves, so a non-admin calling an action
// directly is refused by the database with 42501. The checks in this file
// only turn that into a sentence.

function refused(error: { code?: string; message: string }): { ok: false; error: string } {
  if (error.code === "42501") return { ok: false, error: "You are not a platform admin." };
  return { ok: false, error: error.message };
}

// revalidatePath drops what is cached; refresh() re-renders the page the
// caller is on as part of the action's own response, so the client never
// has to call router.refresh() and race it.
function revalidate(leadId?: string) {
  revalidatePath("/admin/leads");
  if (leadId) revalidatePath(`/admin/leads/${leadId}`);
  refresh();
}

// --- Fetch from OpenStreetMap ----------------------------------------------

export type FetchResult =
  | { ok: true; found: number; added: number }
  | { ok: false; error: string };

export async function fetchOsmLeads(input: { cityId: string }): Promise<FetchResult> {
  const parsed = z.object({ cityId: z.string().min(1).max(32) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { data: city, error: cityError } = await supabase
    .from("lead_cities")
    .select("id, name, state, district, population, lat, lon, is_metro")
    .eq("id", parsed.data.cityId)
    .maybeSingle();
  if (cityError) return refused(cityError);
  if (!city) return { ok: false, error: "That city is not in the list." };

  let rows;
  try {
    rows = await fetchOsmRestaurants(city as LeadCity);
  } catch (e) {
    if (e instanceof OverpassError) return { ok: false, error: e.message };
    return { ok: false, error: "Could not reach OpenStreetMap." };
  }

  const { data: added, error } = await supabase.rpc("import_osm_leads", {
    p_city_id: city.id,
    p_rows: rows,
  });
  if (error) return refused(error);

  revalidate();
  return { ok: true, found: rows.length, added: (added as number | null) ?? 0 };
}

// --- Add one by hand ---------------------------------------------------------

const createSchema = z.object({
  cityId: z.string().min(1).max(32),
  name: z.string().trim().min(1, "Give the restaurant a name").max(120),
  phone: z.string().trim().max(32).optional(),
  website: z.string().trim().max(200).optional(),
  address: z.string().trim().max(300).optional(),
});

export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

export async function createLead(input: z.input<typeof createSchema>): Promise<CreateResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { cityId, name, phone, website, address } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_lead", {
    p_city_id: cityId,
    p_name: name,
    p_phone: phone ?? null,
    p_website: website ?? null,
    p_address: address ?? null,
  });
  if (error) return refused(error);

  revalidate();
  return { ok: true, id: data as string };
}

// --- Contact details -----------------------------------------------------------

const detailsSchema = z.object({
  id: z.string().uuid(),
  phone: z.string().trim().max(32),
  website: z.string().trim().max(200),
  websiteStatus: z.enum(WEBSITE_STATUSES),
  address: z.string().trim().max(300),
  assignedTo: z.string().trim().max(120),
});

export async function updateLeadDetails(
  input: z.input<typeof detailsSchema>,
): Promise<ActionResult> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const d = parsed.data;

  // A URL that was typed in is a website, whatever the radio says.
  const website = d.website || null;
  const websiteStatus = website ? "has" : d.websiteStatus === "has" ? "unknown" : d.websiteStatus;

  const supabase = await createClient();
  const { data: lead, error } = await supabase
    .from("leads")
    .update({
      phone: d.phone || null,
      website,
      website_status: websiteStatus,
      address: d.address || null,
      assigned_to: d.assignedTo || null,
    })
    .eq("id", d.id)
    .select("id, name, phone, restaurant_id, lead_cities(name)")
    .maybeSingle();
  if (error) return refused(error);
  if (!lead) return { ok: false, error: "Lead not found." };

  // A phone typed in now may be a customer's. Only ever fills in a blank:
  // a link already made is not undone by a typo.
  if (!lead.restaurant_id) {
    // The client types a to-one join as an array; at runtime it is one object.
    const joined = lead.lead_cities as unknown as { name: string } | { name: string }[] | null;
    const cityName = (Array.isArray(joined) ? joined[0]?.name : joined?.name) ?? null;
    const { data: match } = await supabase.rpc("match_lead_restaurant", {
      p_name: lead.name,
      p_phone: lead.phone,
      p_city: cityName,
    });
    if (match) {
      await supabase.from("leads").update({ restaurant_id: match }).eq("id", d.id);
    }
  }

  revalidate(d.id);
  return { ok: true };
}

// --- Log a call ------------------------------------------------------------------
//
// One form after every conversation: what was said, where it leaves things,
// what is still pending, and when to go back.

const logSchema = z.object({
  leadId: z.string().uuid(),
  body: z.string().trim().max(2000),
  status: z.enum(LEAD_STATUSES),
  pending: z.string().trim().max(500),
  revisitAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
    .or(z.literal("")),
  revisitType: z.enum(REVISIT_TYPES).or(z.literal("")),
});

export async function logLeadCall(input: z.input<typeof logSchema>): Promise<ActionResult> {
  const parsed = logSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error: updateError, count } = await supabase
    .from("leads")
    .update(
      {
        status: d.status,
        pending: d.pending || null,
        revisit_at: d.revisitAt || null,
        revisit_type: d.revisitAt && d.revisitType ? d.revisitType : null,
      },
      { count: "exact" },
    )
    .eq("id", d.leadId);
  if (updateError) return refused(updateError);
  if (!count) return { ok: false, error: "Lead not found." };

  if (d.body) {
    const { error } = await supabase
      .from("lead_notes")
      .insert({ lead_id: d.leadId, author: user.email ?? null, body: d.body });
    if (error) return refused(error);
  }

  revalidate(d.leadId);
  return { ok: true };
}

// --- Remove ------------------------------------------------------------------------

export async function deleteLead(input: { id: string }): Promise<ActionResult> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.from("leads").delete().eq("id", parsed.data.id);
  if (error) return refused(error);

  revalidate(parsed.data.id);
  return { ok: true };
}
