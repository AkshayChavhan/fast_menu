import type { ReactNode } from "react";
import type { Metadata } from "next";
import { ChefHat, LogOut } from "lucide-react";
import { requireContext } from "@/lib/membership";

export const metadata: Metadata = {
  title: "Kitchen — fast_menu",
};

// Tablet shell for the kitchen ticket screen. Always dark and large: it is
// read from a metre away in a bright, busy room.
export default async function KitchenLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { restaurant } = await requireContext("kitchen:view");

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-neutral-800 bg-neutral-900/95 px-4 backdrop-blur">
        <ChefHat className="h-5 w-5 text-brand-400" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-base font-semibold">
          {restaurant.name} · Kitchen
        </p>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            aria-label="Sign out"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-700 text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </button>
        </form>
      </header>

      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
