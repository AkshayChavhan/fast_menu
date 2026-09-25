import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { TrialReviewList, type TrialReviewRow } from "@/components/admin/TrialReviewList";

export const metadata: Metadata = {
  title: "Trial reviews — fast_menu",
  robots: { index: false, follow: false },
};

// Platform-operator page: hotels whose trial claim collided with a
// look-alike name in the same pincode. Only emails in platform_admins get
// in; everyone else sees a 404 so the page's existence isn't advertised.
// It deliberately does not go through requireContext(): an operator account
// need not own or work at any restaurant.
export default async function TrialReviewsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/trials");

  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) notFound();

  const { data, error } = await supabase.rpc("list_trial_reviews");
  if (error) throw new Error(`Failed to load trial reviews: ${error.message}`);

  const rows = (data as TrialReviewRow[] | null) ?? [];

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <div className="flex items-center gap-2 text-brand-600">
            <ShieldCheck className="h-5 w-5" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wide">
              Platform admin
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Trial reviews</h1>
          <p className="text-sm text-neutral-500">
            Each hotel below claimed a trial with a name close to one already
            using fast_menu in the same pincode. Approve genuine new hotels;
            deny duplicates, whose owners are told to ask for a staff login.
          </p>
        </div>

        <TrialReviewList rows={rows} />
      </div>
    </main>
  );
}
