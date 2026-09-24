import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";

// Builds a small restaurant for the end-to-end run with the service-role
// key: an owner, a waiter, a published menu with ordering on, and a table.
// Everything is keyed by fixed emails and the slug "e2e", and torn down and
// rebuilt on every run so tests start from a known state.

export const E2E = {
  slug: "e2e",
  owner: { email: "e2e-owner@example.com", password: "e2e-owner-pass-123" },
  waiter: { email: "e2e-waiter@example.com", password: "e2e-waiter-pass-123" },
  stateFile: "e2e/.state.json",
};

export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for e2e");
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  async function ensureUser(email: string, password: string, appRole?: string) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
    const existing = list?.users.find((u) => u.email === email);
    if (existing) {
      await admin.auth.admin.updateUserById(existing.id, { password });
      return existing.id;
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: appRole ? { app_role: appRole } : {},
    });
    if (error || !data.user) throw error ?? new Error("could not create user");
    return data.user.id;
  }

  const ownerId = await ensureUser(E2E.owner.email, E2E.owner.password);
  const waiterId = await ensureUser(E2E.waiter.email, E2E.waiter.password, "waiter");

  // The signup trigger gave the owner a starter restaurant; take it over as
  // the e2e restaurant and reset it.
  await admin.from("restaurants").delete().eq("slug", E2E.slug);
  const { data: owned } = await admin
    .from("restaurants")
    .select("id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();
  let restaurantId = owned?.id;
  if (!restaurantId) {
    const { data, error } = await admin
      .from("restaurants")
      .insert({ owner_id: ownerId, name: "E2E Café", slug: E2E.slug })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    restaurantId = data.id;
  }

  const { error: rErr } = await admin
    .from("restaurants")
    .update({
      name: "E2E Café",
      slug: E2E.slug,
      currency: "INR",
      is_published: true,
      trial_status: "active",
      trial_ends_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
      ordering_enabled: true,
      ordering_paused: false,
      allow_takeaway: true,
      table_qr_enabled: true,
      kds_enabled: false,
      timezone: "Asia/Kolkata",
    })
    .eq("id", restaurantId);
  if (rErr) throw rErr;

  // Fresh menu, tables, staff.
  await admin.from("dishes").delete().eq("restaurant_id", restaurantId);
  await admin.from("categories").delete().eq("restaurant_id", restaurantId);
  await admin.from("tables").delete().eq("restaurant_id", restaurantId);
  await admin.from("table_sessions").delete().eq("restaurant_id", restaurantId);
  await admin.from("orders").delete().eq("restaurant_id", restaurantId);

  const { data: cat, error: cErr } = await admin
    .from("categories")
    .insert({ restaurant_id: restaurantId, name: "Drinks", sort_order: 0 })
    .select("id")
    .single<{ id: string }>();
  if (cErr) throw cErr;
  const { error: dErr } = await admin.from("dishes").insert([
    { restaurant_id: restaurantId, category_id: cat.id, name: "Masala Chai", price_cents: 4000, sort_order: 0 },
    { restaurant_id: restaurantId, category_id: cat.id, name: "Filter Coffee", price_cents: 5000, sort_order: 1 },
  ]);
  if (dErr) throw dErr;

  const { data: table, error: tErr } = await admin
    .from("tables")
    .insert({ restaurant_id: restaurantId, label: "Table 1", qr_token: "e2etable1", sort_order: 1 })
    .select("id, qr_token")
    .single<{ id: string; qr_token: string }>();
  if (tErr) throw tErr;

  await admin.from("restaurant_staff").delete().eq("user_id", waiterId);
  const { error: sErr } = await admin.from("restaurant_staff").insert({
    restaurant_id: restaurantId,
    user_id: waiterId,
    role: "waiter",
    display_name: "E2E Waiter",
    email: E2E.waiter.email,
    is_active: true,
  });
  if (sErr) throw sErr;

  mkdirSync("e2e", { recursive: true });
  writeFileSync(
    E2E.stateFile,
    JSON.stringify({ restaurantId, tableToken: table.qr_token, tableId: table.id }, null, 2),
  );
}
