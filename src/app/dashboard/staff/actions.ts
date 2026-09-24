"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRestaurantAccess, type ActionResult } from "../lib";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageRole } from "@/lib/permissions";
import { STAFF_ROLES, type RestaurantStaff, type StaffRole } from "@/types/db";

// Staff accounts are ordinary Supabase users created by an owner or manager
// through the Auth Admin API. Every action here:
//   1. checks the actor holds staff:manage at this restaurant,
//   2. checks the actor may touch the *target* role (owners manage every
//      role; managers manage everyone below manager),
//   3. writes the restaurant_staff row with the actor's own client, so RLS
//      enforces the same rules a second time,
//   4. only then touches auth.users with the service role.

const PASSWORD_MIN = 8;

const passwordField = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(72, "Password is too long");

const createSchema = z.object({
  restaurantId: z.string().uuid(),
  displayName: z.string().trim().min(1, "Name is required").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: passwordField,
  role: z.enum(STAFF_ROLES),
  // Public URL from a direct-to-storage upload (see ImageUpload), when the
  // admin picked a photo while creating the account.
  avatarUrl: z.string().url().max(2048).nullable().optional(),
});

export async function createStaff(input: {
  restaurantId: string;
  displayName: string;
  email: string;
  password: string;
  role: StaffRole;
  avatarUrl?: string | null;
}): Promise<ActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { restaurantId, displayName, email, password, role, avatarUrl } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "staff:manage");
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!canManageRole(guard.role, role)) {
    return { ok: false, error: "Only the owner can add managers" };
  }

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    // Staff never receive a confirmation email; the admin sets the password
    // and hands it over.
    email_confirm: true,
    user_metadata: { full_name: displayName },
    // Read by handle_new_user() so this account gets no restaurant of its
    // own. app_metadata is server-controlled, unlike user_metadata.
    app_metadata: { app_role: role },
  });

  if (createError || !created.user) {
    const message = createError?.message ?? "Could not create the account";
    if (/already|exists|registered/i.test(message)) {
      return { ok: false, error: "An account with this email already exists." };
    }
    return { ok: false, error: message };
  }

  const { error: rowError } = await guard.supabase.from("restaurant_staff").insert({
    restaurant_id: restaurantId,
    user_id: created.user.id,
    role,
    display_name: displayName,
    email,
    avatar_url: avatarUrl ?? null,
    created_by: guard.userId,
  });

  if (rowError) {
    // Don't leave an orphan login behind.
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: rowError.message };
  }

  revalidatePath("/dashboard/staff");
  return { ok: true };
}

// Load the target row through the actor's client; RLS hides rows the actor
// may not see, and canManageRole() stops a manager from touching a manager.
async function loadManagedStaff(
  guard: Extract<Awaited<ReturnType<typeof requireRestaurantAccess>>, { ok: true }>,
  restaurantId: string,
  staffId: string,
): Promise<
  | { ok: true; staff: Pick<RestaurantStaff, "id" | "user_id" | "role"> }
  | { ok: false; error: string }
> {
  const { data } = await guard.supabase
    .from("restaurant_staff")
    .select("id, user_id, role")
    .eq("id", staffId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle<Pick<RestaurantStaff, "id" | "user_id" | "role">>();

  if (!data) return { ok: false, error: "Staff member not found" };
  if (!canManageRole(guard.role, data.role)) {
    return { ok: false, error: "Only the owner can change a manager" };
  }
  return { ok: true, staff: data };
}

const targetSchema = z.object({
  restaurantId: z.string().uuid(),
  staffId: z.string().uuid(),
});

export async function setStaffActive(input: {
  restaurantId: string;
  staffId: string;
  isActive: boolean;
}): Promise<ActionResult> {
  const parsed = targetSchema
    .extend({ isActive: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { restaurantId, staffId, isActive } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "staff:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const target = await loadManagedStaff(guard, restaurantId, staffId);
  if (!target.ok) return target;

  const { error } = await guard.supabase
    .from("restaurant_staff")
    .update({ is_active: isActive })
    .eq("id", staffId)
    .eq("restaurant_id", restaurantId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/staff");
  return { ok: true };
}

// The photo itself is uploaded straight to Storage by the browser (see
// ImageUpload); like the logo, the row only stores the resulting public URL.
// null clears it.
const avatarSchema = targetSchema.extend({
  avatarUrl: z.string().url().max(2048).nullable(),
});

export async function setStaffAvatar(input: {
  restaurantId: string;
  staffId: string;
  avatarUrl: string | null;
}): Promise<ActionResult> {
  const parsed = avatarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid photo URL" };
  const { restaurantId, staffId, avatarUrl } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "staff:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const target = await loadManagedStaff(guard, restaurantId, staffId);
  if (!target.ok) return target;

  const { error } = await guard.supabase
    .from("restaurant_staff")
    .update({ avatar_url: avatarUrl })
    .eq("id", staffId)
    .eq("restaurant_id", restaurantId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/staff");
  return { ok: true };
}

export async function resetStaffPassword(input: {
  restaurantId: string;
  staffId: string;
  password: string;
}): Promise<ActionResult> {
  const parsed = targetSchema
    .extend({ password: passwordField })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { restaurantId, staffId, password } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "staff:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const target = await loadManagedStaff(guard, restaurantId, staffId);
  if (!target.ok) return target;

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(target.staff.user_id, {
    password,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

export async function deleteStaff(input: {
  restaurantId: string;
  staffId: string;
}): Promise<ActionResult> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { restaurantId, staffId } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "staff:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const target = await loadManagedStaff(guard, restaurantId, staffId);
  if (!target.ok) return target;

  // Deleting the auth user cascades to restaurant_staff and profiles.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(target.staff.user_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/staff");
  return { ok: true };
}
