import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UtensilsCrossed } from "lucide-react";

import { requireContext } from "@/lib/membership";
import { homeFor } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { ClaimTrialForm } from "@/components/onboarding/ClaimTrialForm";

export const metadata: Metadata = {
  title: "Activate your free trial — fast_menu",
};

// Owners land here straight after signup (and whenever their trial is not
// active) to claim the one-time 15-day trial for their hotel.
export default async function ClaimTrialPage() {
  const { restaurant, role } = await requireContext(undefined, {
    allowUnclaimedTrial: true,
  });

  if (role !== "owner") redirect(homeFor(role));
  if (restaurant.trial_status === "active") redirect("/dashboard");

  const supabase = await createClient();
  const { data: setting } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "trial_verification")
    .maybeSingle<{ value: string }>();
  const mode = setting?.value === "none" ? "none" : "phone";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xl font-bold tracking-tight text-neutral-900"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white">
              <UtensilsCrossed className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              fast<span className="text-brand-600">_menu</span>
            </span>
          </Link>
        </div>

        <ClaimTrialForm
          restaurantId={restaurant.id}
          restaurantName={restaurant.name}
          initialStatus={restaurant.trial_status}
          initial={{
            phone: restaurant.phone,
            city: restaurant.city,
            pincode: restaurant.pincode,
            gstin: restaurant.gstin,
          }}
          mode={mode}
        />

        <form action="/auth/signout" method="post" className="mt-6 text-center">
          <button
            type="submit"
            className="text-xs font-medium text-neutral-500 underline-offset-2 hover:underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
