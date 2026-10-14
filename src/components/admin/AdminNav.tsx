import Link from "next/link";

import type { AdminRole } from "@/lib/admin-role";

const PAGES = [
  { key: "activity", href: "/admin", label: "Restaurants", ownerOnly: false },
  { key: "plans", href: "/admin/plans", label: "Plans", ownerOnly: false },
  { key: "trials", href: "/admin/trials", label: "Trial reviews", ownerOnly: false },
  { key: "leads", href: "/admin/leads", label: "Leads", ownerOnly: false },
  { key: "payments", href: "/admin/payments", label: "Payments", ownerOnly: true },
  { key: "admins", href: "/admin/admins", label: "Admins", ownerOnly: true },
] as const;

export type AdminPage = (typeof PAGES)[number]["key"];

// Links to the other operator pages. The current one is left out rather than
// highlighted: each page already says what it is in its heading. Owner-only
// pages are left out for a plain admin; the pages themselves 404 anyway.
export function AdminNav({ current, role }: { current: AdminPage; role: AdminRole }) {
  return (
    <nav aria-label="Platform admin" className="ml-auto flex flex-wrap items-center gap-3">
      {PAGES.filter((p) => p.key !== current && (!p.ownerOnly || role === "project_owner")).map(
        (p) => (
          <Link
            key={p.key}
            href={p.href}
            className="text-xs font-medium text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
          >
            {p.label}
          </Link>
        ),
      )}
    </nav>
  );
}
