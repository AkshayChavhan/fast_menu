import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CreditCard } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PlanAdminList, type PlanRow } from "@/components/admin/PlanAdminList";

export const metadata: Metadata = {
  title: "Plans — fast_menu",
  robots: { index: false, follow: false },
};

// Platform-operator page: who is on what plan, and the controls to change it.
// Same shape as /admin/trials — only emails in platform_admins get in, and
// everyone else sees a 404 so the page's existence isn't advertised.
export default async function PlansAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/plans");

  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) notFound();

  const { data, error } = await supabase.rpc("list_restaurant_plans");
  if (error) throw new Error(`Failed to load plans: ${error.message}`);

  const rows = (data as PlanRow[] | null) ?? [];

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <div className="flex items-center gap-2 text-brand-600">
            <CreditCard className="h-5 w-5" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wide">
              Platform admin
            </span>
            <Link
              href="/admin/trials"
              className="ml-auto text-xs font-medium text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
            >
              Trial reviews
            </Link>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Plans</h1>
          <p className="text-sm text-neutral-500">
            {rows.length} restaurant{rows.length === 1 ? "" : "s"}. Granting a
            term extends from whichever is later — today, or the term they have
            left.
          </p>
        </div>

        <PlanAdminList rows={rows} />
      </div>
    </main>
  );
}
