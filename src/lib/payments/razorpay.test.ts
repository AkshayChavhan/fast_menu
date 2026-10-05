import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";

const WEBHOOK_SECRET = "whsec_test";
const KEY_SECRET = "keysec_test";

// The module reads its keys at import time, so the env has to be in place
// before it loads — hence the dynamic import in each test.
async function load() {
  process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  return await import("@/lib/payments/razorpay");
}

const sign = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("hex");

afterEach(() => {
  delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});

describe("pricing", () => {
  it("prices both plans in paise", async () => {
    const { priceFor, TERM_MONTHS } = await load();
    expect(priceFor("starter")).toBe(200000);
    expect(priceFor("pro")).toBe(500000);
    expect(TERM_MONTHS).toBe(12);
  });
});

describe("verifyWebhook", () => {
  it("accepts a correctly signed body", async () => {
    const { verifyWebhook } = await load();
    const raw = '{"event":"payment.captured"}';
    expect(verifyWebhook(raw, sign(WEBHOOK_SECRET, raw))).toBe(true);
  });

  it("rejects a body that was altered after signing", async () => {
    const { verifyWebhook } = await load();
    const signed = sign(WEBHOOK_SECRET, '{"event":"payment.captured","amount":500000}');
    expect(verifyWebhook('{"event":"payment.captured","amount":100}', signed)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const { verifyWebhook } = await load();
    const raw = '{"event":"payment.captured"}';
    expect(verifyWebhook(raw, sign("not-the-secret", raw))).toBe(false);
  });

  it("rejects a missing or malformed signature", async () => {
    const { verifyWebhook } = await load();
    const raw = '{"event":"payment.captured"}';
    expect(verifyWebhook(raw, null)).toBe(false);
    expect(verifyWebhook(raw, "")).toBe(false);
    expect(verifyWebhook(raw, "not-hex")).toBe(false);
    // Right length, wrong bytes.
    expect(verifyWebhook(raw, "0".repeat(64))).toBe(false);
  });
});

describe("verifyCheckout", () => {
  it("accepts the handshake the widget returns", async () => {
    const { verifyCheckout } = await load();
    const sig = sign(KEY_SECRET, "order_1|pay_1");
    expect(verifyCheckout("order_1", "pay_1", sig)).toBe(true);
  });

  // Swapping the ids is the obvious forgery to try.
  it("rejects a signature for a different order", async () => {
    const { verifyCheckout } = await load();
    const sig = sign(KEY_SECRET, "order_2|pay_1");
    expect(verifyCheckout("order_1", "pay_1", sig)).toBe(false);
  });
});
