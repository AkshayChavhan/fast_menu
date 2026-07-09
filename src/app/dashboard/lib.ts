import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Restaurant } from "@/types/db";

// Resolves the authenticated user and their "active" restaurant (their first,
// by creation date). The middleware guards /dashboard and redirects anonymous
// users to /login, but we re-check here so Server Components can rely on a
// non-null user/restaurant without extra guards.
export async function getActiveContext(): Promise<{
  userId: string;
  email: string | null;
  restaurant: Restaurant;
}> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: restaurant, error } = await supabase
    .from("restaurants")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load restaurant: ${error.message}`);
  }

  // Every user is provisioned a restaurant on signup (see schema handle_new_user),
  // but guard defensively in case that trigger hasn't run.
  if (!restaurant) {
    throw new Error(
      "No restaurant found for this account. Please contact support.",
    );
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    restaurant: restaurant as Restaurant,
  };
}
