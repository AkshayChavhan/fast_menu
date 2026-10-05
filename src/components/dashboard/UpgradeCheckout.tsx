"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2 } from "lucide-react";

// Razorpay injects itself onto window; this is the slice we use.
type RazorpayInstance = { open: () => void };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Could not load checkout")));
      return;
    }
    const el = document.createElement("script");
    el.src = SCRIPT;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Could not load checkout"));
    document.body.appendChild(el);
  });
}

export function UpgradeCheckout({
  restaurantId,
  restaurantName,
  email,
}: {
  restaurantId: string;
  restaurantName: string;
  email: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      await loadCheckout();

      // The amount is never sent from here: the server prices the plan and
      // registers it against the order.
      const res = await fetch("/api/payments/razorpay/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, plan: "pro" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the payment");
      if (!window.Razorpay) throw new Error("Could not load checkout");

      const rzp = new window.Razorpay({
        key: data.keyId,
        order_id: data.orderId,
        amount: data.amount,
        currency: data.currency,
        name: "fast_menu",
        description: `Pro plan — ${restaurantName}`,
        prefill: email ? { email } : undefined,
        theme: { color: "#ea580c" },
        // The webhook is what grants the term. This only decides which screen
        // the owner sees, because a tab closed mid-payment never gets here.
        handler: () => {
          setDone(true);
          setBusy(false);
          // Give the webhook a moment, then re-read the plan.
          setTimeout(() => router.refresh(), 3000);
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950/40 dark:text-green-200">
        Payment received — thank you. Pro switches on within a minute; refresh
        if this page still shows Starter.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={pay}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <CreditCard className="h-4 w-4" aria-hidden />
        )}
        Pay ₹5,000 for a year
      </button>
      <p className="text-xs text-neutral-500">
        UPI, cards and netbanking. Your term starts when the payment clears.
      </p>
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
