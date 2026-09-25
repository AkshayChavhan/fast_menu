import "server-only";

import webpush from "web-push";

import { createAdminClient } from "@/lib/supabase/admin";
import type { StaffRole } from "@/types/db";

// Web Push to staff phones. Silently a no-op until VAPID keys are set, so a
// restaurant without push configured loses nothing but the buzz.

export interface PushPayload {
  title: string;
  body: string;
  /** Where a tap should land. */
  url: string;
  /** Same tag replaces an earlier notification instead of stacking. */
  tag?: string;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function configured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}

// Send `payload` to every subscribed browser of the restaurant's owner and
// of staff holding one of `roles`.
export async function notifyRestaurant(
  restaurantId: string,
  roles: StaffRole[],
  payload: PushPayload,
): Promise<void> {
  if (!configured()) return;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:hello@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

  const admin = createAdminClient();

  const [subsRes, staffRes, ownerRes] = await Promise.all([
    admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .eq("restaurant_id", restaurantId),
    admin
      .from("restaurant_staff")
      .select("user_id")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .in("role", roles),
    admin.from("restaurants").select("owner_id").eq("id", restaurantId).maybeSingle<{ owner_id: string }>(),
  ]);

  const allowed = new Set<string>(
    ((staffRes.data as { user_id: string }[] | null) ?? []).map((s) => s.user_id),
  );
  if (ownerRes.data?.owner_id) allowed.add(ownerRes.data.owner_id);

  const subs = ((subsRes.data as SubscriptionRow[] | null) ?? []).filter((s) => allowed.has(s.user_id));
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  const dead: string[] = [];

  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 120, urgency: "high" },
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(s.id);
      }
    }),
  );

  if (dead.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", dead);
  }
}

// Send `payload` to every subscribed browser of specific users (for example
// the waiter who approved an order, when the kitchen marks it ready).
export async function notifyUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!configured() || userIds.length === 0) return;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:hello@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

  const admin = createAdminClient();
  const { data } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  const subs = (data as SubscriptionRow[] | null) ?? [];
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 120, urgency: "high" },
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(s.id);
      }
    }),
  );
  if (dead.length > 0) await admin.from("push_subscriptions").delete().in("id", dead);
}
