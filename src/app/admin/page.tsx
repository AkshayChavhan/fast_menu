import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Activity } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { buildDashboard, type ActivityRow } from "@/lib/admin-activity";
import { AdminNav } from "@/components/admin/AdminNav";
import { AttentionList, SummaryTiles } from "@/components/admin/ActivitySummary";
import { RestaurantActivityList } from "@/components/admin/RestaurantActivityList";

export const metadata: Metadata = {
  title: "Restaurants — fast_menu",
  robots: { index: false, follow: false },
};

// Platform-operator page: which restaurants are really using fast_menu, and
// who needs a call today. Same gate as /admin/plans and /admin/trials — only
// emails in platform_admins get in, and everyone else sees a 404 so the page's
// existence isn't advertised.
export default async function AdminActivityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");

  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) notFound();

  const { data, error } = await supabase.rpc("list_restaurant_activity");
  if (error) throw new Error(`Failed to load restaurant activity: ${error.message}`);

  const rows = (data as ActivityRow[] | null) ?? [];
  // One clock for the whole page: the verdicts are worked out here and the
  // client list only filters them.
  const now = new Date();
  const { summary, attention, restaurants } = buildDashboard(rows, now);

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <div className="flex items-center gap-2 text-brand-600">
            <Activity className="h-5 w-5" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wide">
              Platform admin
            </span>
            <AdminNav current="activity" />
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Restaurants</h1>
          <p className="text-sm text-neutral-500">
            Who is set up, who is taking orders, and who needs a call. Orders
            are counted, never totalled: a restaurant&apos;s takings stay its own.
          </p>
        </div>

        <SummaryTiles summary={summary} />
        <AttentionList items={attention} />
        <RestaurantActivityList restaurants={restaurants} nowIso={now.toISOString()} />
      </div>
    </main>
  );
}
