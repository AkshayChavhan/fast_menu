"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/dashboard/lib";

const schema = z.object({
  restaurantId: z.string().uuid(),
  approve: z.boolean(),
});

// review_trial() checks is_platform_admin() itself, so a non-admin calling
// this directly is refused by the database with 42501.
export async function reviewTrial(input: {
  restaurantId: string;
  approve: boolean;
}): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_trial", {
    rid: parsed.data.restaurantId,
    approve: parsed.data.approve,
  });

  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "You are not a platform admin." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/trials");
  return { ok: true };
}
