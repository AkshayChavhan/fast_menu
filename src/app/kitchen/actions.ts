"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { notifyUsers } from "@/lib/push";
import type { ActionResult } from "@/app/dashboard/lib";

const uuid = z.string().uuid();
const status = z.enum(["preparing", "ready", "served"]);

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "You don't have permission to do that.";
  if (error.code === "P0001" || error.code === "22023") return error.message;
  if (error.code === "PGRST202") {
    return "The kitchen database functions are missing. Run the files in supabase/migrations/ first.";
  }
  return "Something went wrong. Please try again.";
}

function revalidateKitchen(code?: string) {
  revalidatePath("/kitchen");
  if (code) revalidatePath(`/waiter/orders/${code}`);
}

// Tell the waiter who approved the order that the whole ticket is ready.
async function notifyReady(orderId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("code, approved_by, table_id")
    .eq("id", orderId)
    .maybeSingle<{ code: string; approved_by: string | null; table_id: string | null }>();
  if (!data?.approved_by) return;
  const { data: table } = data.table_id
    ? await supabase.from("tables").select("label").eq("id", data.table_id).maybeSingle<{ label: string }>()
    : { data: null };
  await notifyUsers([data.approved_by], {
    title: `${table?.label ?? "Order"} is ready`,
    body: `Order ${data.code} is ready to serve.`,
    url: `/waiter/orders/${data.code}`,
    tag: `ready-${data.code}`,
  });
}

export async function setItemStatus(input: {
  itemId: string;
  status: "preparing" | "ready" | "served";
  code?: string;
}): Promise<ActionResult> {
  const parsed = z.object({ itemId: uuid, status, code: z.string().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_item_kds_status", {
    p_item_id: parsed.data.itemId,
    p_status: parsed.data.status,
  });
  if (error) return { ok: false, error: friendly(error) };

  const result = data as { order_id?: string; order_ready?: boolean } | null;
  if (parsed.data.status === "ready" && result?.order_ready && result.order_id) {
    const orderId = result.order_id;
    after(() => notifyReady(orderId));
  }

  revalidateKitchen(parsed.data.code);
  return { ok: true };
}

export async function setOrderStatus(input: {
  orderId: string;
  status: "preparing" | "ready" | "served";
  code?: string;
}): Promise<ActionResult> {
  const parsed = z.object({ orderId: uuid, status, code: z.string().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_order_kds_status", {
    p_order_id: parsed.data.orderId,
    p_status: parsed.data.status,
  });
  if (error) return { ok: false, error: friendly(error) };

  if (parsed.data.status === "ready") {
    const orderId = parsed.data.orderId;
    after(() => notifyReady(orderId));
  }

  revalidateKitchen(parsed.data.code);
  return { ok: true };
}
