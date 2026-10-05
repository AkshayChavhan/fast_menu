import { createClient } from "@/lib/supabase/server";
import { can, isMemberRole, type Capability } from "@/lib/permissions";
import {
  effectivePlan,
  planAllows,
  staffLimit,
  UPGRADE_PROMPTS,
  type Plan,
  type PlanFeature,
} from "@/lib/plans";
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

// ---------------------------------------------------------------------------
// Plan gates
//
// Always read the plan from the database inside the action. A plan passed in
// from the client is a plan the client can edit, and these gates are what
// stands between a starter account and the Pro features.
// ---------------------------------------------------------------------------

type PlanRow = {
  plan: Plan;
  plan_expires_at: string | null;
  trial_status: "pending" | "active" | "needs_review" | "denied";
  trial_ends_at: string;
};

export async function getPlan(
  supabase: Db,
  restaurantId: string,
): Promise<Plan> {
  const { data } = await supabase
    .from("restaurants")
    .select("plan, plan_expires_at, trial_status, trial_ends_at")
    .eq("id", restaurantId)
    .maybeSingle<PlanRow>();

  // A restaurant we cannot read is not one we hand Pro features to.
  if (!data) return "starter";
  return effectivePlan(data);
}

// Fails with the upgrade wording rather than a permission error: the actor is
// allowed to do this, the plan isn't.
export async function requirePlanFeature(
  supabase: Db,
  restaurantId: string,
  feature: PlanFeature,
): Promise<ActionResult> {
  const plan = await getPlan(supabase, restaurantId);
  if (planAllows(plan, feature)) return { ok: true };
  return { ok: false, error: UPGRADE_PROMPTS[feature] };
}

// Room for one more active staff login? Counts only active rows, so a
// restaurant with turnover is not punished for the people who have left. The
// owner is not a restaurant_staff row and never counts.
export async function ensureStaffRoom(
  supabase: Db,
  restaurantId: string,
): Promise<ActionResult> {
  const plan = await getPlan(supabase, restaurantId);
  const limit = staffLimit(plan);

  if (limit === 0) {
    return { ok: false, error: UPGRADE_PROMPTS.staff };
  }

  const { count, error } = await supabase
    .from("restaurant_staff")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true);

  if (error) return { ok: false, error: error.message };

  if ((count ?? 0) >= limit) {
    return {
      ok: false,
      error: `Your plan includes ${limit} staff logins. Deactivate someone, or get in touch to add more.`,
    };
  }
  return { ok: true };
}

