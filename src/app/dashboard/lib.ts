import { createClient } from "@/lib/supabase/server";
import { can, isMemberRole, type Capability } from "@/lib/permissions";
import { requireContext, type ActiveContext } from "@/lib/membership";
import type { MemberRole } from "@/types/db";

export type { ActiveContext } from "@/lib/membership";

type Db = Awaited<ReturnType<typeof createClient>>;

// The dashboard's context: owner, manager or cashier plus their restaurant.
// Waiter and kitchen roles are bounced by the layout.
export async function getActiveContext(): Promise<ActiveContext> {
  return requireContext();
}

// For pages: load the context and send roles that can't use this page to
// their own home. Navigation already hides such pages; this is the backstop
// for a typed URL.
export async function requireCapability(
  capability: Capability,
): Promise<ActiveContext> {
  return requireContext(capability);
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
