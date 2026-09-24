"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRestaurantAccess } from "@/app/dashboard/lib";

export type ClaimStatus = "active" | "needs_review" | "denied" | "error";

export interface ClaimResult {
  status: ClaimStatus;
  reason: string | null;
}

const inputSchema = z.object({
  restaurantId: z.string().uuid(),
  // E.164 as the browser built it ("+919876543210"); the database strips
  // formatting again and compares against the Auth-verified number.
  phone: z.string().trim().min(8).max(20),
  gstin: z.string().trim().max(20).nullable(),
  city: z.string().trim().max(80).nullable(),
  pincode: z.string().trim().max(12).nullable(),
});

const resultSchema = z.object({
  status: z.enum(["active", "needs_review", "denied", "error"]),
  reason: z.string().nullable().optional(),
});

export async function claimTrial(input: {
  restaurantId: string;
  phone: string;
  gstin: string | null;
  city: string | null;
  pincode: string | null;
}): Promise<ClaimResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: "error", reason: "phone_invalid" };
  const { restaurantId, phone, gstin, city, pincode } = parsed.data;

  // Only the owner holds settings:manage; managers never see this page.
  const guard = await requireRestaurantAccess(restaurantId, "settings:manage");
  if (!guard.ok) return { status: "error", reason: guard.error };

  const { data, error } = await guard.supabase.rpc("claim_trial", {
    rid: restaurantId,
    p_phone: phone,
    p_gstin: gstin,
    p_city: city,
    p_pincode: pincode,
  });

  if (error) {
    if (error.code === "PGRST202") {
      return {
        status: "error",
        reason:
          "The claim_trial database function is missing. Run the files in supabase/migrations/ first.",
      };
    }
    return { status: "error", reason: error.message };
  }

  const result = resultSchema.safeParse(data);
  if (!result.success) return { status: "error", reason: "Unexpected response" };

  revalidatePath("/dashboard");
  revalidatePath("/onboarding/claim");

  return { status: result.data.status, reason: result.data.reason ?? null };
}
