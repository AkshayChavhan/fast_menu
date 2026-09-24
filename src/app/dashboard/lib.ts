import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  can,
  homeFor,
  isMemberRole,
  type Capability,
} from "@/lib/permissions";
import type { MemberRole, Restaurant, RestaurantStaff } from "@/types/db";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface ActiveContext {
  userId: string;
  email: string | null;
  restaurant: Restaurant;
  role: MemberRole;
}

export interface Membership {
  restaurant: Restaurant;
  role: MemberRole;
}

// Resolves the authenticated user and the restaurant they belong to. Owners
// get their first restaurant (by creation date); staff get the one their
// restaurant_staff row points at. The proxy guards /dashboard and redirects
// anonymous users to /login, but we re-check here so Server Components can
// rely on a non-null user/restaurant without extra guards.
export async function getActiveContext(): Promise<ActiveContext> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await resolveMembership(supabase, user.id);

  // Every signup is provisioned a restaurant (see handle_new_user) and every
  // staff account is created with a restaurant_staff row, so this only fires
  // for a deactivated staff member or a broken provisioning trigger.
  if (!membership) {
    throw new Error(
      "No restaurant found for this account. Please contact support.",
    );
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    ...membership,
  };
}

// Where does this user work, and as what? Owner first, then an active staff
// row. Shared by the dashboard context and by login routing.
export async function resolveMembership(
  supabase: Db,
  userId: string,
): Promise<Membership | null> {
  const { data: owned, error } = await supabase
    .from("restaurants")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<Restaurant>();

  if (error) {
    throw new Error(`Failed to load restaurant: ${error.message}`);
  }
  if (owned) return { restaurant: owned, role: "owner" };

  const { data: staff } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id, role, is_active")
    .eq("user_id", userId)
    .maybeSingle<Pick<RestaurantStaff, "restaurant_id" | "role" | "is_active">>();

  if (!staff || !staff.is_active) return null;

  // restaurants_member_read lets active staff read their own restaurant.
  const { data: restaurant, error: restaurantError } = await supabase
    .from("restaurants")
    .select("*")
    .eq("id", staff.restaurant_id)
    .maybeSingle<Restaurant>();

  if (restaurantError) {
    throw new Error(`Failed to load restaurant: ${restaurantError.message}`);
  }
  if (!restaurant) return null;

  return { restaurant, role: staff.role };
}

// For pages: load the context and send roles that can't use this page to
// their own home. Navigation already hides such pages; this is the backstop
// for a typed URL.
export async function requireCapability(
  capability: Capability,
): Promise<ActiveContext> {
  const ctx = await getActiveContext();
  if (!can(ctx.role, capability)) {
    redirect(homeFor(ctx.role));
  }
  return ctx;
}

// Uniform result shape for every dashboard server action.
export type ActionResult = { ok: true } | { ok: false; error: string };

// The signed-in user's role at a restaurant, as the database sees it.
export async function getMemberRole(
  supabase: Db,
  restaurantId: string,
): Promise<MemberRole | null> {
  const { data, error } = await supabase.rpc("member_role", {
    rid: restaurantId,
  });
  if (error || typeof data !== "string" || !isMemberRole(data)) return null;
  return data;
}

// Assert the signed-in user may perform `capability` at `restaurantId`,
// returning a client for the follow-up mutation. RLS enforces the same rules
// at the database; this exists so actions can fail with a friendly message
// instead of an empty update, and so every dashboard action guards the same
// way.
export type RestaurantAccess =
  | { ok: false; error: string }
  | { ok: true; supabase: Db; userId: string; role: MemberRole };

export async function requireRestaurantAccess(
  restaurantId: string,
  capability: Capability,
): Promise<RestaurantAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const role = await getMemberRole(supabase, restaurantId);
  if (!role) return { ok: false, error: "Restaurant not found" };
  if (!can(role, capability)) {
    return { ok: false, error: "You don't have permission to do that" };
  }
  return { ok: true, supabase, userId: user.id, role };
}
