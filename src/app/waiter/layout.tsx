import type { ReactNode } from "react";
import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { requireContext } from "@/lib/membership";
import { ROLE_LABELS } from "@/lib/permissions";
import { WaiterTabs } from "@/components/waiter/WaiterTabs";
import { PushToggle } from "@/components/waiter/PushToggle";

export const metadata: Metadata = {
  title: "Waiter — fast_menu",
};

// Phone-first shell for everyone who serves tables: waiters, plus managers
// and owners who want to work the floor. requireContext() sends any other
// role to its own home.
export default async function WaiterLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { restaurant, role } = await requireContext("orders:serve");

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white/90 px-4 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={restaurant.name}>
            {restaurant.name}
          </p>
          <p className="text-[11px] text-neutral-500">{ROLE_LABELS[role]}</p>
        </div>
        <PushToggle />
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            aria-label="Sign out"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </button>
        </form>
      </header>

      {/* Bottom padding clears the fixed tab bar. */}
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-24 pt-4">
        {children}
      </main>

      <WaiterTabs />
    </div>
  );
}
