"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "../lib";

// Billing counter actions. The database re-checks the role and the bill's
// state inside settle_session() / reopen_session().

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "You don't have permission to do that.";
  if (error.code === "P0001" || error.code === "22023") return error.message;
  if (error.code === "PGRST202") {
    return "The billing database functions are missing. Run the files in supabase/migrations/ first.";
  }
  return "Something went wrong. Please try again.";
}

function revalidateBilling() {
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard");
  revalidatePath("/waiter");
  revalidatePath("/waiter/tables");
}

export async function settleSession(input: {
  sessionId: string;
  paymentMethod?: string;
}): Promise<ActionResult> {
  const parsed = z
    .object({ sessionId: z.string().uuid(), paymentMethod: z.string().trim().max(40).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("settle_session", {
    p_session_id: parsed.data.sessionId,
    p_payment_method: parsed.data.paymentMethod ?? null,
  });
  if (error) return { ok: false, error: friendly(error) };

  revalidateBilling();
  return { ok: true };
}

export async function reopenSession(input: { sessionId: string }): Promise<ActionResult> {
  const parsed = z.object({ sessionId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_session", { p_session_id: parsed.data.sessionId });
  if (error) return { ok: false, error: friendly(error) };

  revalidateBilling();
  return { ok: true };
}
