import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, ExternalLink } from "lucide-react";

import { requireAdmin } from "@/app/admin/lib";
import { AdminNav } from "@/components/admin/AdminNav";
import { ROLE_LABELS } from "@/lib/permissions";
import { PLAN_LABELS, type Plan } from "@/lib/plans";
import { publicMenuPath } from "@/lib/paths";
import type { MemberRole } from "@/types/db";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Restaurant — fast_menu",
  robots: { index: false, follow: false },
};

interface Detail {
  restaurant: {
    id: string;
    name: string;
    slug: string;
    city: string | null;
    pincode: string | null;
    phone: string | null;
    gstin: string | null;
    owner_email: string | null;
    currency: string;
    default_locale: string;
    locales: string[];
    timezone: string;
    is_published: boolean;
    is_live: boolean;
    plan: Plan;
    plan_expires_at: string | null;
    effective_plan: Plan;
    trial_status: string;
    trial_ends_at: string;
    ordering_enabled: boolean;
    ordering_paused: boolean;
    table_qr_enabled: boolean;
    kds_enabled: boolean;
    allow_takeaway: boolean;
    has_review_link: boolean;
    created_at: string;
    updated_at: string;
  };
  staff: {
    id: string;
    display_name: string | null;
    email: string | null;
    role: MemberRole;
    is_active: boolean;
    created_at: string;
  }[];
  menu: {
    id: string;
    name: string;
    dishes: {
      id: string;
      name: string;
      price_cents: number;
      is_available: boolean;
      has_image: boolean;
    }[];
  }[];
  uncategorised_dishes: number;
  // Present for a project owner only.
  payments?: {
    id: string;
    plan: Plan;
    months: number;
    amount_paise: number;
    status: "created" | "paid" | "failed";
    created_at: string;
    paid_at: string | null;
  }[];
}

const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    cents / 100,
  );

// Platform-admin page: one restaurant, read only, for a support call.
// Profile, plan, the switches they have turned on, the staff roster and the
// menu. Nothing here can be changed, and orders, takings, guests and review
// text are not loaded at all: those are the restaurant's own business.
export default async function AdminRestaurantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { supabase, role } = await requireAdmin(`/admin/restaurants/${id}`);

  const { data, error } = await supabase.rpc("admin_restaurant_detail", { rid: id });
  if (error) {
    if (error.code === "22023") notFound();
    throw new Error(`Failed to load restaurant: ${error.message}`);
  }
  const { restaurant: r, staff, menu, uncategorised_dishes, payments } = data as Detail;
  const dishCount = menu.reduce((n, c) => n + c.dishes.length, 0) + uncategorised_dishes;

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <div className="flex items-center gap-2 text-brand-600">
            <Building2 className="h-5 w-5" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wide">Platform admin</span>
            <AdminNav current="activity" role={role} />
          </div>
          <Link
            href={`/admin#r-${r.id}`}
            className="mt-2 inline-flex items-center gap-1 text-xs text-neutral-500 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            All restaurants
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{r.name}</h1>
          <p className="text-sm text-neutral-500">
            Read only. What an operator needs on a support call; the
            restaurant&apos;s orders and takings stay its own.
          </p>
        </div>

        <Card title="Profile">
          <Facts
            items={[
              ["Owner", r.owner_email ?? "—"],
              ["Phone", r.phone ?? "—"],
              ["City", [r.city, r.pincode].filter(Boolean).join(" ") || "—"],
              ["GSTIN", r.gstin ?? "—"],
              [
                "Menu",
                <a
                  key="menu"
                  href={publicMenuPath(r.slug)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-brand-700 underline dark:text-brand-300"
                >
                  /m/{r.slug}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>,
              ],
              ["Languages", r.locales.join(", ") + ` (default ${r.default_locale})`],
              ["Currency", r.currency],
              ["Timezone", r.timezone],
              ["Signed up", day(r.created_at)],
              ["Last changed", day(r.updated_at)],
            ]}
          />
        </Card>

        <Card title="Plan and trial">
          <Facts
            items={[
              ["On today", PLAN_LABELS[r.effective_plan]],
              ["Tier set to", PLAN_LABELS[r.plan]],
              ["Paid until", day(r.plan_expires_at)],
              ["Trial", `${r.trial_status} · ends ${day(r.trial_ends_at)}`],
              ["Published", r.is_published ? "Yes" : "No"],
              ["Menu live", r.is_live ? "Yes" : "No"],
            ]}
          />
          {role === "project_owner" ? (
            <p className="mt-3 text-xs text-neutral-500">
              Change the plan from{" "}
              <Link href="/admin/plans" className="underline">
                Plans
              </Link>
              .
            </p>
          ) : null}
        </Card>

        <Card title="Set up">
          <ul className="flex flex-wrap gap-2 text-xs">
            <Flag on={r.ordering_enabled} label="Ordering" />
            <Flag on={r.ordering_paused} label="Ordering paused" warn />
            <Flag on={r.table_qr_enabled} label="Table QR" />
            <Flag on={r.kds_enabled} label="Kitchen screen" />
            <Flag on={r.allow_takeaway} label="Takeaway" />
            <Flag on={r.has_review_link} label="Google review link" />
          </ul>
        </Card>

        <Card title={`Staff (${staff.length})`}>
          {staff.length === 0 ? (
            <p className="text-sm text-neutral-500">Only the owner so far.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
              {staff.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                  <span className={cn("font-medium", !s.is_active && "text-neutral-400 line-through")}>
                    {s.display_name ?? s.email ?? "—"}
                  </span>
                  <span className="text-xs text-neutral-500">{ROLE_LABELS[s.role]}</span>
                  {s.email && s.display_name ? (
                    <span className="text-xs text-neutral-400">{s.email}</span>
                  ) : null}
                  {!s.is_active ? (
                    <span className="text-xs text-neutral-400">deactivated</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Menu (${dishCount} ${dishCount === 1 ? "dish" : "dishes"})`}>
          {menu.length === 0 && uncategorised_dishes === 0 ? (
            <p className="text-sm text-neutral-500">Nothing on the menu yet.</p>
          ) : (
            <div className="space-y-3">
              {menu.map((c) => (
                <div key={c.id}>
                  <h3 className="text-sm font-semibold">
                    {c.name}{" "}
                    <span className="font-normal text-neutral-500">({c.dishes.length})</span>
                  </h3>
                  {c.dishes.length ? (
                    <ul className="mt-1 grid gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
                      {c.dishes.map((d) => (
                        <li key={d.id} className="flex justify-between gap-2">
                          <span className={cn(!d.is_available && "text-neutral-400 line-through")}>
                            {d.name}
                            {!d.has_image ? (
                              <span className="ml-1 text-xs text-neutral-400">no photo</span>
                            ) : null}
                          </span>
                          <span className="tabular-nums text-neutral-600 dark:text-neutral-300">
                            {money(d.price_cents, r.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
              {uncategorised_dishes > 0 ? (
                <p className="text-xs text-neutral-500">
                  {uncategorised_dishes} more not in any category.
                </p>
              ) : null}
            </div>
          )}
        </Card>

        {payments ? (
          <Card title={`Payments (${payments.length})`}>
            {payments.length === 0 ? (
              <p className="text-sm text-neutral-500">Nothing paid yet.</p>
            ) : (
              <ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 py-1.5">
                    <span className="w-24 text-xs text-neutral-500">
                      {day(p.paid_at ?? p.created_at)}
                    </span>
                    <span>
                      {PLAN_LABELS[p.plan]} · {p.months} mo
                    </span>
                    <span className="tabular-nums">{money(p.amount_paise, "INR")}</span>
                    <span
                      className={cn(
                        "text-xs",
                        p.status === "paid"
                          ? "text-green-700 dark:text-green-300"
                          : p.status === "failed"
                            ? "text-red-700 dark:text-red-300"
                            : "text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {p.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="w-28 shrink-0 text-neutral-500">{k}</dt>
          <dd className="min-w-0 truncate">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Flag({ on, label, warn = false }: { on: boolean; label: string; warn?: boolean }) {
  return (
    <li
      className={cn(
        "rounded-full px-2.5 py-1 font-medium",
        on
          ? warn
            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
            : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
          : "bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500",
      )}
    >
      {label}
      {on ? "" : " off"}
    </li>
  );
}
