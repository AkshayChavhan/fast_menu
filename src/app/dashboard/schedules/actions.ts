"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRestaurantAccess, type ActionResult } from "../lib";

const SCHEDULES_MAX = 20;

function revalidateScheduleSurfaces() {
  revalidatePath("/dashboard/schedules");
  revalidatePath("/dashboard/menu");
}

const timeField = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM times");

const scheduleFields = {
  name: z.string().trim().min(1, "Give the schedule a name").max(60),
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1, "Pick at least one day")
    .transform((d) => Array.from(new Set(d)).sort((a, b) => a - b)),
  startsAt: timeField,
  endsAt: timeField,
  isActive: z.boolean(),
};

const createSchema = z
  .object({ restaurantId: z.string().uuid(), ...scheduleFields })
  .refine((s) => s.startsAt !== s.endsAt, {
    message: "Start and end can't be the same minute",
  });

export async function createSchedule(input: {
  restaurantId: string;
  name: string;
  days: number[];
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}): Promise<ActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { restaurantId, name, days, startsAt, endsAt, isActive } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "menu:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { count } = await guard.supabase
    .from("menu_schedules")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId);
  if ((count ?? 0) >= SCHEDULES_MAX) {
    return { ok: false, error: `You can have at most ${SCHEDULES_MAX} schedules.` };
  }

  const { error } = await guard.supabase.from("menu_schedules").insert({
    restaurant_id: restaurantId,
    name,
    days,
    starts_at: startsAt,
    ends_at: endsAt,
    is_active: isActive,
  });
  if (error) return { ok: false, error: error.message };

  revalidateScheduleSurfaces();
  return { ok: true };
}

const updateSchema = z
  .object({
    restaurantId: z.string().uuid(),
    scheduleId: z.string().uuid(),
    ...scheduleFields,
  })
  .refine((s) => s.startsAt !== s.endsAt, {
    message: "Start and end can't be the same minute",
  });

export async function updateSchedule(input: {
  restaurantId: string;
  scheduleId: string;
  name: string;
  days: number[];
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { restaurantId, scheduleId, name, days, startsAt, endsAt, isActive } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "menu:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase
    .from("menu_schedules")
    .update({ name, days, starts_at: startsAt, ends_at: endsAt, is_active: isActive })
    .eq("id", scheduleId)
    .eq("restaurant_id", restaurantId);
  if (error) return { ok: false, error: error.message };

  revalidateScheduleSurfaces();
  return { ok: true };
}

const targetSchema = z.object({
  restaurantId: z.string().uuid(),
  scheduleId: z.string().uuid(),
});

export async function setScheduleActive(input: {
  restaurantId: string;
  scheduleId: string;
  isActive: boolean;
}): Promise<ActionResult> {
  const parsed = targetSchema.extend({ isActive: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { restaurantId, scheduleId, isActive } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "menu:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase
    .from("menu_schedules")
    .update({ is_active: isActive })
    .eq("id", scheduleId)
    .eq("restaurant_id", restaurantId);
  if (error) return { ok: false, error: error.message };

  revalidateScheduleSurfaces();
  return { ok: true };
}

// Categories that used the schedule fall back to "always" (on delete set null).
export async function deleteSchedule(input: {
  restaurantId: string;
  scheduleId: string;
}): Promise<ActionResult> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { restaurantId, scheduleId } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "menu:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase
    .from("menu_schedules")
    .delete()
    .eq("id", scheduleId)
    .eq("restaurant_id", restaurantId);
  if (error) return { ok: false, error: error.message };

  revalidateScheduleSurfaces();
  return { ok: true };
}
