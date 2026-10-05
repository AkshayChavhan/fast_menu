"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { PLANS } from "@/lib/plans";
import type { ActionResult } from "@/app/dashboard/lib";

const schema = z.object({
  restaurantId: z.string().uuid(),
  plan: z.enum(PLANS),
  // 0 clears the paid term; anything else extends from whichever is later,
  // now or the current expiry.
  months: z.number().int().min(0).max(120),
});

// set_restaurant_plan() checks is_platform_admin() itself, so a non-admin
// calling this directly is refused by the database with 42501.
export async function setRestaurantPlan(input: {
  restaurantId: string;
  plan: string;
  months: number;
}): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_restaurant_plan", {
    rid: parsed.data.restaurantId,
    p_plan: parsed.data.plan,
    p_months: parsed.data.months,
  });

  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "You are not a platform admin." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/plans");
  // The dashboard reads the plan on every render, so its cache has to go too.
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
