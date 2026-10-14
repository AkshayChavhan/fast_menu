"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES } from "@/lib/admin-role";
import type { ActionResult } from "@/app/dashboard/lib";

// Both functions check is_project_owner() themselves and refuse everyone
// else with 42501; the last project owner cannot be removed or demoted
// (22023). This file only turns those into sentences.

function failed(error: { code?: string; message: string }): ActionResult {
  if (error.code === "42501") return { ok: false, error: "Only the project owner can do that." };
  if (error.code === "22023") return { ok: false, error: error.message };
  return { ok: false, error: error.message };
}

const setSchema = z.object({
  email: z.string().trim().toLowerCase().email("That is not an email address").max(200),
  role: z.enum(ADMIN_ROLES),
});

export async function setPlatformAdmin(input: z.input<typeof setSchema>): Promise<ActionResult> {
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_platform_admin", {
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });
  if (error) return failed(error);
  revalidatePath("/admin/admins");
  return { ok: true };
}

export async function removePlatformAdmin(input: { email: string }): Promise<ActionResult> {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_platform_admin", { p_email: parsed.data.email });
  if (error) return failed(error);
  revalidatePath("/admin/admins");
  return { ok: true };
}
