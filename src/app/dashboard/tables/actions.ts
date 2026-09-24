"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRestaurantAccess, type ActionResult } from "../lib";

export const TABLES_MAX = 300;
const LABEL_MAX = 40;

function revalidateTableSurfaces() {
  revalidatePath("/dashboard/tables");
  revalidatePath("/dashboard/qr");
  revalidatePath("/waiter");
}

const labelField = z.string().trim().min(1, "A table needs a name").max(LABEL_MAX);

const createSchema = z.object({
  restaurantId: z.string().uuid(),
  labels: z.array(labelField).min(1, "Add at least one table").max(TABLES_MAX),
});

// Bulk add: the form usually sends "1".."20" or a pasted list. Labels that
// already exist are skipped rather than failing the whole batch.
export async function createTables(input: {
  restaurantId: string;
  labels: string[];
}): Promise<ActionResult & { added?: number; skipped?: number }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { restaurantId } = parsed.data;
  const labels = Array.from(new Set(parsed.data.labels));

  const guard = await requireRestaurantAccess(restaurantId, "tables:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { data: existing } = await guard.supabase
    .from("tables")
    .select("label, sort_order")
    .eq("restaurant_id", restaurantId);
  const have = new Set((existing ?? []).map((t) => t.label as string));
  let nextOrder =
    (existing ?? []).reduce((m, t) => Math.max(m, (t.sort_order as number) ?? 0), -1) + 1;

  if (have.size + labels.length > TABLES_MAX) {
    return { ok: false, error: `A restaurant can have at most ${TABLES_MAX} tables.` };
  }

  const rows = labels
    .filter((label) => !have.has(label))
    .map((label) => ({ restaurant_id: restaurantId, label, sort_order: nextOrder++ }));

  if (rows.length > 0) {
    const { error } = await guard.supabase.from("tables").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  revalidateTableSurfaces();
  return { ok: true, added: rows.length, skipped: labels.length - rows.length };
}

const targetSchema = z.object({
  restaurantId: z.string().uuid(),
  tableId: z.string().uuid(),
});

export async function renameTable(input: {
  restaurantId: string;
  tableId: string;
  label: string;
}): Promise<ActionResult> {
  const parsed = targetSchema.extend({ label: labelField }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { restaurantId, tableId, label } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "tables:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase
    .from("tables")
    .update({ label })
    .eq("id", tableId)
    .eq("restaurant_id", restaurantId);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Another table already has that name." };
    return { ok: false, error: error.message };
  }

  revalidateTableSurfaces();
  return { ok: true };
}

export async function setTableActive(input: {
  restaurantId: string;
  tableId: string;
  isActive: boolean;
}): Promise<ActionResult> {
  const parsed = targetSchema.extend({ isActive: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { restaurantId, tableId, isActive } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "tables:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase
    .from("tables")
    .update({ is_active: isActive })
    .eq("id", tableId)
    .eq("restaurant_id", restaurantId);
  if (error) return { ok: false, error: error.message };

  revalidateTableSurfaces();
  return { ok: true };
}

export async function deleteTable(input: {
  restaurantId: string;
  tableId: string;
}): Promise<ActionResult> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { restaurantId, tableId } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "tables:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase
    .from("tables")
    .delete()
    .eq("id", tableId)
    .eq("restaurant_id", restaurantId);
  if (error) return { ok: false, error: error.message };

  revalidateTableSurfaces();
  return { ok: true };
}
