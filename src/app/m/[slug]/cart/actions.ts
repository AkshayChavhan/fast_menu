"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { notifyRestaurant } from "@/lib/push";

// Public, unauthenticated. Everything the browser sends is treated as
// hostile: the restaurant is resolved from the slug, prices are re-read by
// the database, and this connection is rate-limited before the call.

const PER_IP_LIMIT = 12;
const PER_IP_WINDOW = "10 minutes";

const lineSchema = z.object({
  dish_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  note: z.string().trim().max(200).nullable(),
  variant_option_id: z.string().uuid().nullable(),
  addon_option_ids: z.array(z.string().uuid()).max(20),
});

const placeSchema = z.object({
  slug: z.string().trim().min(1).max(120),
  tableToken: z.string().trim().max(40).nullable(),
  serviceType: z.enum(["dine_in", "takeaway"]),
  note: z.string().trim().max(300),
  lines: z.array(lineSchema).min(1, "Your order is empty").max(50),
  deviceKey: z.string().trim().max(80),
  locale: z.string().trim().max(10),
});

export type PlaceOrderResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

// The first address in X-Forwarded-For is the client behind Vercel's proxy.
async function clientIpHash(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

function friendlyError(error: { code?: string; message: string }): string {
  // P0001 (raise) and 22023 (invalid parameter) carry messages written for
  // the guest inside place_order().
  if (error.code === "P0001" || error.code === "22023") return error.message;
  if (error.code === "PGRST202") {
    return "Ordering isn't set up on this menu yet. Please ask a member of staff.";
  }
  return "We couldn't place your order. Please try again.";
}

export async function placeOrder(input: {
  slug: string;
  tableToken: string | null;
  serviceType: "dine_in" | "takeaway";
  note: string;
  lines: unknown;
  deviceKey: string;
  locale: string;
}): Promise<PlaceOrderResult> {
  const parsed = placeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check your order" };
  }
  const { slug, tableToken, serviceType, note, lines, deviceKey, locale } = parsed.data;

  const supabase = await createClient();

  const { data: allowed } = await supabase.rpc("check_rate_limit", {
    p_key: `ip:${await clientIpHash()}`,
    p_limit: PER_IP_LIMIT,
    p_window: PER_IP_WINDOW,
  });
  if (allowed === false) {
    return {
      ok: false,
      error: "Too many orders from this connection. Please wait a few minutes or ask a member of staff.",
    };
  }

  const { data, error } = await supabase.rpc("place_order", {
    p_slug: slug,
    p_table_token: tableToken,
    p_service_type: serviceType,
    p_note: note,
    p_items: lines,
    p_device_key: deviceKey,
    p_locale: locale,
  });

  if (error) {
    // Anything but a message written for the guest is a bug or an outage;
    // the guest sees a generic line, the log keeps the cause.
    if (error.code !== "P0001" && error.code !== "22023") {
      console.error(
        `place_order failed for ${slug}: ${error.code ?? "no code"} ${error.message}`,
        error.details ?? "",
        error.hint ?? "",
      );
    }
    return { ok: false, error: friendlyError(error) };
  }

  const result = data as
    | { code?: string; restaurant_id?: string; table_label?: string | null }
    | null;
  const code = result?.code;
  if (!code) return { ok: false, error: "We couldn't place your order. Please try again." };

  // Buzz the floor after the response is sent; a slow push must not slow
  // the guest.
  if (result.restaurant_id) {
    const restaurantId = result.restaurant_id;
    const count = lines.reduce((n, l) => n + l.quantity, 0);
    const where = result.table_label ?? (serviceType === "takeaway" ? "Parcel" : "No table yet");
    after(() =>
      notifyRestaurant(restaurantId, ["manager", "waiter"], {
        title: `New order ${code}`,
        body: `${where} · ${count} ${count === 1 ? "item" : "items"}. Tap to approve.`,
        url: `/waiter/orders/${code}`,
        tag: `order-${code}`,
      }),
    );
  }

  return { ok: true, code };
}

const cancelSchema = z.object({
  slug: z.string().trim().min(1).max(120),
  code: z.string().trim().min(4).max(12),
  deviceKey: z.string().trim().max(80),
});

export async function cancelOrder(input: {
  slug: string;
  code: string;
  deviceKey: string;
}): Promise<{ ok: boolean }> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const { data } = await supabase.rpc("cancel_order_by_code", {
    p_slug: parsed.data.slug,
    p_code: parsed.data.code,
    p_device_key: parsed.data.deviceKey,
  });
  return { ok: data === true };
}
