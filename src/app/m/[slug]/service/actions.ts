"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

// "Call a waiter" / "Ask for the bill" from a table QR. Public and
// unauthenticated; the database requires a valid table code and keeps one
// open request of each kind per table.

const schema = z.object({
  slug: z.string().trim().min(1).max(120),
  tableToken: z.string().trim().min(1).max(40),
  kind: z.enum(["call_waiter", "request_bill"]),
  deviceKey: z.string().trim().max(80),
});

export type ServiceRequestResult =
  | { ok: true; existing: boolean }
  | { ok: false; error: string };

async function clientIpHash(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export async function requestService(input: {
  slug: string;
  tableToken: string;
  kind: "call_waiter" | "request_bill";
  deviceKey: string;
}): Promise<ServiceRequestResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Scan the code on your table first." };
  const { slug, tableToken, kind, deviceKey } = parsed.data;

  const supabase = await createClient();

  const { data: allowed } = await supabase.rpc("check_rate_limit", {
    p_key: `svc:${await clientIpHash()}`,
    p_limit: 20,
    p_window: "10 minutes",
  });
  if (allowed === false) {
    return { ok: false, error: "Please wait a moment before asking again." };
  }

  const { data, error } = await supabase.rpc("create_service_request", {
    p_slug: slug,
    p_table_token: tableToken,
    p_kind: kind,
    p_device_key: deviceKey,
  });

  if (error) {
    if (error.code === "P0001" || error.code === "22023") return { ok: false, error: error.message };
    return { ok: false, error: "We couldn't reach the staff. Please wave to a waiter." };
  }

  return { ok: true, existing: (data as { existing?: boolean } | null)?.existing === true };
}
