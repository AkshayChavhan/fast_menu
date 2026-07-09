"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { SidebarNav } from "./SidebarNav";
import { cn } from "@/lib/utils";

// Hamburger-triggered slide-over sidebar for small screens. On >=lg the static
// sidebar in the layout is shown instead and this button is hidden.
export function MobileNav({ restaurantName }: { restaurantName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 lg:hidden dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div
        className={cn(
          "fixed inset-0 z-40 lg:hidden",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={cn(
            "absolute inset-0 bg-black/40 transition-opacity",
            open ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          className={cn(
            "absolute left-0 top-0 flex h-full w-72 max-w-[80%] flex-col gap-6 bg-white p-4 shadow-xl transition-transform dark:bg-neutral-900",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold text-brand-600">fast_menu</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="truncate px-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
            {restaurantName}
          </p>
          <SidebarNav onNavigate={() => setOpen(false)} />
        </div>
      </div>
    </>
  );
}
