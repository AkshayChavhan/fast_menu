import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { getActiveContext } from "./lib";
import { SidebarNav } from "@/components/dashboard/SidebarNav";
import { MobileNav } from "@/components/dashboard/MobileNav";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { restaurant, email } = await getActiveContext();

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      {/* Topbar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white/90 px-4 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
        <MobileNav restaurantName={restaurant.name} />
        <div className="flex min-w-0 items-center gap-2">
          <span className="hidden text-lg font-bold text-brand-600 lg:inline">
            fast_menu
          </span>
          <span className="hidden text-neutral-300 lg:inline">/</span>
          <span className="truncate text-sm font-semibold" title={restaurant.name}>
            {restaurant.name}
          </span>
          <span
            className={
              "ml-1 hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline " +
              (restaurant.is_published
                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400")
            }
          >
            {restaurant.is_published ? "Published" : "Draft"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {email ? (
            <span className="hidden max-w-[180px] truncate text-xs text-neutral-500 sm:inline">
              {email}
            </span>
          ) : null}
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl">
        {/* Static sidebar (desktop) */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 border-r border-neutral-200 p-4 lg:block dark:border-neutral-800">
          <p className="mb-3 px-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Manage
          </p>
          <SidebarNav />
        </aside>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
