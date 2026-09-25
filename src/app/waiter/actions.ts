"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { OrderLineInput } from "@/types/db";

// Thin wrappers over the staff ordering functions. The database re-checks
// the caller's role and the order's status inside every function, so these
// only validate shape, translate errors and refresh the screens.

export type StaffActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "You don't have permission to do that.";
  if (error.code === "P0001" || error.code === "22023") return error.message;
  if (error.code === "PGRST202") {
    return "The ordering database functions are missing. Run the files in supabase/migrations/ first.";
  }
  return "Something went wrong. Please try again.";
}

function revalidateWaiter(code?: string) {
  revalidatePath("/waiter");
  revalidatePath("/waiter/tables");
  revalidatePath("/dashboard/orders");
  if (code) revalidatePath(`/waiter/orders/${code}`);
}

const uuid = z.string().uuid();
const tableIds = z.array(uuid).max(12);
const serviceType = z.enum(["dine_in", "takeaway"]);
const label = z.string().trim().max(80);

const lineSchema = z.object({
  dish_id: uuid,
  quantity: z.number().int().min(1).max(99),
  note: z.string().trim().max(200).nullable(),
  variant_option_id: uuid.nullable(),
  addon_option_ids: z.array(uuid).max(20),
});

export async function approveOrder(input: {
  orderId: string;
  code: string;
  tableIds: string[];
  serviceType: "dine_in" | "takeaway";
  guestLabel: string;
}): Promise<StaffActionResult<{ sessionId: string }>> {
  const parsed = z
    .object({ orderId: uuid, code: z.string(), tableIds, serviceType, guestLabel: label })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_order", {
    p_order_id: parsed.data.orderId,
    p_table_ids: parsed.data.tableIds,
    p_service_type: parsed.data.serviceType,
    p_guest_label: parsed.data.guestLabel || null,
  });
  if (error) return { ok: false, error: friendly(error) };

  revalidateWaiter(parsed.data.code);
  return { ok: true, data: { sessionId: (data as { session_id: string }).session_id } };
}

export async function rejectOrder(input: {
  orderId: string;
  code: string;
  reason: string;
}): Promise<StaffActionResult> {
  const parsed = z
    .object({ orderId: uuid, code: z.string(), reason: z.string().trim().max(200) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_order", {
    p_order_id: parsed.data.orderId,
    p_reason: parsed.data.reason || null,
  });
  if (error) return { ok: false, error: friendly(error) };

  revalidateWaiter(parsed.data.code);
  return { ok: true };
}

export async function cancelStaffOrder(input: {
  orderId: string;
  code: string;
  reason: string;
}): Promise<StaffActionResult> {
  const parsed = z
    .object({ orderId: uuid, code: z.string(), reason: z.string().trim().max(200) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("staff_cancel_order", {
    p_order_id: parsed.data.orderId,
    p_reason: parsed.data.reason || null,
  });
  if (error) return { ok: false, error: friendly(error) };

  revalidateWaiter(parsed.data.code);
  return { ok: true };
}

export async function createStaffOrder(input: {
  restaurantId: string;
  tableIds: string[];
  serviceType: "dine_in" | "takeaway";
  guestLabel: string;
  note: string;
  lines: OrderLineInput[];
}): Promise<StaffActionResult<{ code: string; orderId: string }>> {
  const parsed = z
    .object({
      restaurantId: uuid,
      tableIds,
      serviceType,
      guestLabel: label,
      note: z.string().trim().max(300),
      lines: z.array(lineSchema).min(1, "Add at least one dish").max(50),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_create_order", {
    p_restaurant_id: parsed.data.restaurantId,
    p_table_ids: parsed.data.tableIds,
    p_service_type: parsed.data.serviceType,
    p_guest_label: parsed.data.guestLabel || null,
    p_note: parsed.data.note,
    p_items: parsed.data.lines,
  });
  if (error) return { ok: false, error: friendly(error) };

  const result = data as { id: string; code: string };
  revalidateWaiter(result.code);
  return { ok: true, data: { code: result.code, orderId: result.id } };
}

export async function setStaffOrderItems(input: {
  orderId: string;
  code: string;
  lines: OrderLineInput[];
}): Promise<StaffActionResult> {
  const parsed = z
    .object({ orderId: uuid, code: z.string(), lines: z.array(lineSchema).min(1, "Keep at least one dish").max(50) })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("staff_set_order_items", {
    p_order_id: parsed.data.orderId,
    p_items: parsed.data.lines,
  });
  if (error) return { ok: false, error: friendly(error) };

  revalidateWaiter(parsed.data.code);
  return { ok: true };
}

export async function moveOrder(input: {
  orderId: string;
  code: string;
  tableIds: string[];
  serviceType: "dine_in" | "takeaway";
  guestLabel: string;
}): Promise<StaffActionResult> {
  const parsed = z
    .object({ orderId: uuid, code: z.string(), tableIds, serviceType, guestLabel: label })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("staff_move_order", {
    p_order_id: parsed.data.orderId,
    p_table_ids: parsed.data.tableIds,
    p_service_type: parsed.data.serviceType,
    p_guest_label: parsed.data.guestLabel || null,
  });
  if (error) return { ok: false, error: friendly(error) };

  revalidateWaiter(parsed.data.code);
  return { ok: true };
}

export async function seatTables(input: {
  restaurantId: string;
  tableIds: string[];
  guestLabel: string;
}): Promise<StaffActionResult> {
  const parsed = z.object({ restaurantId: uuid, tableIds, guestLabel: label }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("open_table_session", {
    p_restaurant_id: parsed.data.restaurantId,
    p_table_ids: parsed.data.tableIds,
    p_guest_label: parsed.data.guestLabel || null,
  });
  if (error) return { ok: false, error: friendly(error) };

  revalidateWaiter();
  return { ok: true };
}

export async function clearSession(input: { sessionId: string }): Promise<StaffActionResult> {
  const parsed = z.object({ sessionId: uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_table_session", { p_session_id: parsed.data.sessionId });
  if (error) return { ok: false, error: friendly(error) };

  revalidateWaiter();
  return { ok: true };
}

export async function resolveRequest(input: { requestId: string }): Promise<StaffActionResult> {
  const parsed = z.object({ requestId: uuid }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_service_request", { p_request_id: parsed.data.requestId });
  if (error) return { ok: false, error: friendly(error) };

  revalidateWaiter();
  return { ok: true };
}
