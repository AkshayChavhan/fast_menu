"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { resolveMembership } from "@/lib/membership";

// A browser hands us its push subscription; we file it under the user and
// their restaurant. RLS only lets a user write rows for themselves.

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(200),
  }),
  userAgent: z.string().max(300).optional(),
});

export type PushActionResult = { ok: true } | { ok: false; error: string };

export async function savePushSubscription(input: unknown): Promise<PushActionResult> {
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid subscription" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const membership = await resolveMembership(supabase, user.id);
  if (!membership) return { ok: false, error: "No restaurant" };

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      restaurant_id: membership.restaurant.id,
      user_id: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      user_agent: parsed.data.userAgent ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function removePushSubscription(input: { endpoint: string }): Promise<PushActionResult> {
  const parsed = z.object({ endpoint: z.string().url().max(2000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid subscription" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", parsed.data.endpoint);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
