import type { Metadata } from "next";
import { Check, Mail, MessageCircle, Sparkles } from "lucide-react";

import { getActiveContext } from "../lib";
import { effectivePlan, PLAN_LABELS } from "@/lib/plans";
import {
  hasSupportContact,
  upgradeMailto,
  upgradeWhatsapp,
} from "@/lib/support";
import { paymentsConfigured } from "@/lib/payments/razorpay";
import { UpgradeCheckout } from "@/components/dashboard/UpgradeCheckout";

export const metadata: Metadata = {
  title: "Upgrade — fast_menu",
};

const STARTER = [
  "QR menu with photos, allergens and dietary tags",
  "Unlimited categories and dishes",
  "Sizes and add-ons, pairings, sold-out toggle",
  "Two languages",
  "Guest reviews and your Google review link",
  "Import and export your whole menu",
];

const PRO = [
  "Table ordering — guests order from the QR code",
  "Per-table QR codes",
  "Waiter app: take, edit and move orders",
  "Kitchen screen",
  "Billing counter and the day's history",
  "Up to 10 staff logins",
  "All 19 languages",
  "Breakfast / lunch / dinner schedules and daily specials",
  "No fast_menu branding on your menu",
];

export default async function UpgradePage() {
  const { restaurant, email } = await getActiveContext();
  const plan = effectivePlan(restaurant);
  const isPro = plan === "pro";

  const mailto = upgradeMailto(restaurant.name, restaurant.slug);
  const whatsapp = upgradeWhatsapp(restaurant.name);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2 text-brand-600">
          <Sparkles className="h-5 w-5" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wide">
            {PLAN_LABELS[plan]} plan
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {isPro ? "You're on Pro" : "Upgrade to Pro"}
        </h1>
        <p className="text-sm text-neutral-500">
          {isPro
            ? "Everything below is switched on for your restaurant."
            : "Your menu keeps working exactly as it does now. Pro adds the parts that run your floor."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-semibold">Starter</h2>
          <p className="mt-0.5 text-2xl font-bold">
            ₹2,000<span className="text-sm font-medium text-neutral-500">/year</span>
          </p>
          <ul className="mt-3 space-y-1.5">
            {STARTER.map((item) => (
              <li key={item} className="flex gap-2 text-sm text-neutral-600 dark:text-neutral-300">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border-2 border-brand-500 bg-white p-5 dark:bg-neutral-900">
          <h2 className="text-sm font-semibold text-brand-600">Pro</h2>
          <p className="mt-0.5 text-2xl font-bold">
            ₹5,000<span className="text-sm font-medium text-neutral-500">/year</span>
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">Everything in Starter, plus:</p>
          <ul className="mt-3 space-y-1.5">
            {PRO.map((item) => (
              <li key={item} className="flex gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {isPro ? null : (
        <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-sm font-semibold">Ready to upgrade?</h2>

          {paymentsConfigured() ? (
            <div className="mt-3">
              <UpgradeCheckout
                restaurantId={restaurant.id}
                restaurantName={restaurant.name}
                email={email}
              />
            </div>
          ) : null}

          {hasSupportContact() ? (
            <>
              <p className="mt-3 text-sm text-neutral-500">
                Prefer to pay another way, or have a question? Get in touch.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {mailto ? (
                  <a
                    href={mailto}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
                  >
                    <Mail className="h-4 w-4" aria-hidden /> Email us
                  </a>
                ) : null}
                {whatsapp ? (
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
                  </a>
                ) : null}
              </div>
            </>
          ) : (
            // Better to say nothing than to print an address that bounces.
            <p className="mt-1 text-sm text-neutral-500">
              Get in touch with your fast_menu contact and we&apos;ll switch Pro
              on for {restaurant.name}.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
