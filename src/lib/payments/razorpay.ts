import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Plan } from "@/lib/plans";

// Razorpay, because the customers are Indian restaurants: UPI, cards and
// netbanking in one checkout, settled to an Indian bank account. Everything
// provider-specific lives in this file so swapping it later is one module.
//
// No SDK: the Orders API is one POST with basic auth, and verification is an
// HMAC. A dependency here would be more surface, not less work.

const API = "https://api.razorpay.com/v1";

export const RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";

export function paymentsConfigured(): boolean {
  return RAZORPAY_KEY_ID !== "" && KEY_SECRET !== "";
}

// Paise, because that is what the gateway speaks and what avoids every
// floating-point rounding argument.
export const PLAN_PRICE_PAISE: Record<Plan, number> = {
  starter: 2_000_00,
  pro: 5_000_00,
};

/** Months a single purchase buys. Annual only, for now. */
export const TERM_MONTHS = 12;

export function priceFor(plan: Plan): number {
  return PLAN_PRICE_PAISE[plan];
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

// Create the order server-side. The browser never says what it is paying: it
// is handed an order id, and the amount is whatever we registered against it.
export async function createOrder(input: {
  amountPaise: number;
  receipt: string;
  notes: Record<string, string>;
}): Promise<RazorpayOrder> {
  if (!paymentsConfigured()) {
    throw new Error("Razorpay keys are not configured.");
  }

  const res = await fetch(`${API}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Basic " + Buffer.from(`${RAZORPAY_KEY_ID}:${KEY_SECRET}`).toString("base64"),
    },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt,
      notes: input.notes,
      payment_capture: 1,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Razorpay rejected the order (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as RazorpayOrder;
}

// Constant-time compare so a wrong signature cannot be narrowed down by
// timing. Lengths are compared first because timingSafeEqual throws on a
// mismatch.
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Verify a webhook. `raw` must be the exact bytes Razorpay sent: re-serialising
 * the parsed JSON changes key order and whitespace, and the HMAC with it.
 */
export function verifyWebhook(raw: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET || !signature) return false;
  const expected = createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
  return safeEqualHex(expected, signature);
}

/**
 * Verify the handshake the checkout widget hands back to the browser. Only
 * used to show the right screen — the webhook is what actually grants the
 * term, because a browser that closes mid-payment never calls back.
 */
export function verifyCheckout(
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  if (!KEY_SECRET) return false;
  const expected = createHmac("sha256", KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return safeEqualHex(expected, signature);
}
