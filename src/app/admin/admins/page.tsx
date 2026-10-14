import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

import { requireProjectOwner } from "@/app/admin/lib";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminManager, type AdminRow } from "@/components/admin/AdminManager";
import { PlaceholderRestaurants, type PlaceholderRow } from "@/components/admin/PlaceholderRestaurants";

export const metadata: Metadata = {
  title: "Admins — fast_menu",
  robots: { index: false, follow: false },
};

interface AuditRow {
  id: string;
  actor: string | null;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

// Says what a row did in one line, without making the reader parse JSON.
function describe(a: AuditRow): string {
  const d = a.details as {
    role?: string;
    to?: { plan?: string; months?: number };
    from?: { plan?: string };
  };
  switch (a.action) {
    case "admin.set":
      return `${a.target} set to ${d.role === "project_owner" ? "project owner" : "admin"}`;
    case "admin.remove":
      return `${a.target} removed`;
    case "restaurant.remove_placeholder":
      return `empty restaurant "${(d as { name?: string }).name ?? a.target}" of ${(d as { owner_email?: string }).owner_email ?? "?"} removed`;
    case "leads.replace":
      return `leads in ${(d as { city?: string }).city ?? a.target} replaced (${(d as { removed?: number }).removed ?? "?"} removed)`;
    case "plan.set":
      return d.to?.months
        ? `plan ${d.from?.plan ?? "?"} → ${d.to.plan} for ${d.to.months} months`
        : `paid term ended (was ${d.from?.plan ?? "?"})`;
    default:
      return `${a.action} ${a.target ?? ""}`.trim();
  }
}

// Project-owner page: who can open the operator pages, and the log of what
// owners changed.
export default async function AdminsPage() {
  const { supabase, user, role } = await requireProjectOwner("/admin/admins");

  const [adminsRes, auditRes, placeholdersRes] = await Promise.all([
    supabase.rpc("list_platform_admins"),
    supabase.rpc("list_platform_audit", { p_limit: 50 }),
    supabase.rpc("operator_placeholder_restaurants"),
  ]);
  if (adminsRes.error) throw new Error(`Failed to load admins: ${adminsRes.error.message}`);
  if (auditRes.error) throw new Error(`Failed to load audit log: ${auditRes.error.message}`);

  // The placeholder list came in a later migration than the rest of this
  // page. Until that migration is applied the function is missing (PostgREST
  // answers PGRST202); that is a notice to the owner, not a reason to take
  // the whole page down.
  let placeholders: PlaceholderRow[] = [];
  let pendingMigration: string | null = null;
  if (placeholdersRes.error) {
    if (placeholdersRes.error.code === "PGRST202") {
      pendingMigration = "20260924003900_operator_accounts.sql";
    } else {
      throw new Error(`Failed to load placeholder restaurants: ${placeholdersRes.error.message}`);
    }
  } else {
    placeholders = (placeholdersRes.data as PlaceholderRow[] | null) ?? [];
  }

  const admins = (adminsRes.data as AdminRow[] | null) ?? [];
  const audit = (auditRes.data as AuditRow[] | null) ?? [];

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <div className="flex items-center gap-2 text-brand-600">
            <ShieldCheck className="h-5 w-5" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wide">Project owner</span>
            <AdminNav current="admins" role={role} />
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Admins</h1>
          <p className="text-sm text-neutral-500">
            Who can open these pages. The last project owner cannot be removed
            or demoted, so nobody gets locked out.
          </p>
        </div>

        <AdminManager rows={admins} selfEmail={user.email ?? ""} />

        {pendingMigration ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            A database migration is pending: <code>{pendingMigration}</code>. Paste{" "}
            <code>supabase/pending-migrations.generated.sql</code> into the Supabase SQL
            editor and run it to manage placeholder restaurants here.
          </p>
        ) : (
          <PlaceholderRestaurants rows={placeholders} />
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            What owners changed{" "}
            <span className="font-normal text-neutral-500">(last {audit.length})</span>
          </h2>
          {audit.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing yet.</p>
          ) : (
            <ol
              aria-label="What owners changed"
              className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white text-sm dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900"
            >
              {audit.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-x-3 gap-y-0.5 px-4 py-2">
                  <span className="w-28 shrink-0 text-xs text-neutral-500">{when(a.created_at)}</span>
                  <span className="min-w-0 flex-1">
                    {describe(a)}
                    <span className="ml-2 text-xs text-neutral-400">by {a.actor ?? "?"}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
