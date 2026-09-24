import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, homeFor, type Capability } from "@/lib/permissions";
import { tagRequest } from "@/lib/monitoring";
import type { MemberRole, Restaurant, RestaurantStaff } from "@/types/db";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface Membership {
  restaurant: Restaurant;
  role: MemberRole;
}

export interface ActiveContext extends Membership {
  userId: string;
  email: string | null;
}

export interface RequireOptions {
  // The trial claim page opts out of the "owner must claim first" redirect.
  allowUnclaimedTrial?: boolean;
}

// Owners must claim their one-time trial before the dashboard opens, and a
// denied claim locks it. needs_review is allowed in (publishing is blocked
// separately) so a hotel under review can keep building its menu.
export function trialBlocksAccess(status: Restaurant["trial_status"]): boolean {
  return status === "pending" || status === "denied";
}

// Where does this user work, and as what? Owners first (their first
// restaurant by creation date), then an active staff row. Shared by every
// signed-in area and by the post-login router.
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

// The signed-in user's context for a page, or a redirect:
//   - not signed in            → /login
//   - no active membership     → /auth/home (signs out with an explanation)
//   - owner, trial unclaimed   → /onboarding/claim
//   - lacks `capability`       → the role's own home
// The proxy already gates the signed-in areas, but pages re-check so Server
// Components can rely on a non-null user/restaurant without extra guards.
export async function requireContext(
  capability?: Capability,
  options: RequireOptions = {},
): Promise<ActiveContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await resolveMembership(supabase, user.id);
  if (!membership) redirect("/auth/home");

  if (
    !options.allowUnclaimedTrial &&
    membership.role === "owner" &&
    trialBlocksAccess(membership.restaurant.trial_status)
  ) {
    redirect("/onboarding/claim");
  }

  if (capability && !can(membership.role, capability)) {
    redirect(homeFor(membership.role));
  }

  tagRequest({ userId: user.id, restaurantId: membership.restaurant.id, role: membership.role });

  return { userId: user.id, email: user.email ?? null, ...membership };
}
