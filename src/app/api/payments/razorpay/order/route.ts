import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRestaurantAccess } from "@/app/dashboard/lib";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLANS } from "@/lib/plans";
import {
  createOrder,
  paymentsConfigured,
  priceFor,
  RAZORPAY_KEY_ID,
  TERM_MONTHS,
} from "@/lib/payments/razorpay";

export const dynamic = "force-dynamic";

const schema = z.object({
  restaurantId: z.string().uuid(),
  plan: z.enum(PLANS),
});

// POST /api/payments/razorpay/order
//
// Starts a purchase. The browser sends which restaurant and which plan — never
// an amount: the price is looked up here, registered against the order with
// the gateway, and checked again in apply_paid_term() when the webhook lands.
export async function POST(request: Request) {
  if (!paymentsConfigured()) {
    return NextResponse.json(
      { error: "Payments are not configured yet. Please get in touch." },
      { status: 503 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { restaurantId, plan } = parsed.data;

  // Paying is a settings-level act, so it needs the settings capability.
  const guard = await requireRestaurantAccess(restaurantId, "settings:manage");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: 403 });
  }

  const amountPaise = priceFor(plan);

  let order;
  try {
    order = await createOrder({
      amountPaise,
      receipt: `r_${restaurantId.slice(0, 8)}_${Date.now()}`,
      notes: { restaurant_id: restaurantId, plan, months: String(TERM_MONTHS) },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not start the payment" },
      { status: 502 },
    );
  }

  // Written with the service role: the webhook later settles this row, and
  // nothing should be able to write payments through RLS.
  const admin = createAdminClient();
  const { error } = await admin.from("payments").insert({
    restaurant_id: restaurantId,
    provider: "razorpay",
    provider_order_id: order.id,
    plan,
    months: TERM_MONTHS,
    amount_paise: amountPaise,
    created_by: guard.userId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: RAZORPAY_KEY_ID,
  });
}
