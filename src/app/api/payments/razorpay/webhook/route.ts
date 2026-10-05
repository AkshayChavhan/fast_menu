import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhook } from "@/lib/payments/razorpay";
import { captureError } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

// POST /api/payments/razorpay/webhook
//
// The only thing that actually grants a paid term. Not the browser callback:
// a guest who pays and then closes the tab never calls back, and anything the
// browser says can be forged. This endpoint trusts one thing — an HMAC over
// the raw body, keyed with the webhook secret.
//
// Razorpay retries on any non-2xx, so a failure here is recoverable and a
// duplicate delivery is harmless: apply_paid_term() is idempotent on the order
// id. The one case that must NOT 500 is a payload we understand and choose to
// ignore, or we would be retried forever.
export async function POST(request: Request) {
  // The exact bytes: re-serialising parsed JSON would change the HMAC.
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!verifyWebhook(raw, signature)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  let event: {
    event?: string;
    payload?: {
      payment?: { entity?: { id?: string; order_id?: string; amount?: number } };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    // Signed but unparseable: nothing to retry into.
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  // order.paid also exists; payment.captured is the one that means money has
  // actually moved.
  if (event.event !== "payment.captured") {
    return NextResponse.json({ ok: true, ignored: event.event ?? "unknown" });
  }

  const entity = event.payload?.payment?.entity;
  if (!entity?.order_id || !entity.id || typeof entity.amount !== "number") {
    return NextResponse.json({ ok: true, ignored: "incomplete payload" });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_paid_term", {
    p_provider_order_id: entity.order_id,
    p_provider_payment_id: entity.id,
    p_amount_paise: entity.amount,
  });

  if (error) {
    // 22023 is our own refusal — an unknown order, or an amount short of what
    // we registered. Retrying will not change either, so acknowledge and let
    // the alert carry it to a human.
    const permanent = error.code === "22023";
    captureError(error, {
      where: "razorpay.webhook",
      orderId: entity.order_id,
      permanent,
    });
    if (permanent) {
      return NextResponse.json({ ok: true, ignored: error.message });
    }
    return NextResponse.json({ error: "Could not apply the payment" }, { status: 500 });
  }

  // A short payment is recorded, not retried — but it should reach a human.
  const result = data as { applied?: boolean; reason?: string } | null;
  if (result?.applied === false && result.reason === "amount_short") {
    captureError(new Error("Razorpay payment short of the expected amount"), {
      where: "razorpay.webhook",
      orderId: entity.order_id,
      result,
    });
  }

  return NextResponse.json({ ok: true, result: data });
}
