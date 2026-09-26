"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";
import { SidebarNav } from "./SidebarNav";
import { cn } from "@/lib/utils";
import type { MemberRole } from "@/types/db";

// false while server-rendering and during hydration, true afterwards. Written
// with useSyncExternalStore rather than a setState in an effect, which the
// lint rules disallow — and which would render one extra time for no reason.
const neverChanges = () => () => {};
const useMounted = () =>
  useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );

// Hamburger-triggered slide-over sidebar for small screens. On >=lg the static
// sidebar in the layout is shown instead and this button is hidden.
//
// The drawer is rendered into document.body rather than in place. It has to
// be: this component sits inside the dashboard's sticky <header>, and that
// header carries `backdrop-blur`. A non-none backdrop-filter makes an element
// a containing block for fixed-position descendants, so `fixed inset-0` would
// resolve against the 56px-tall header instead of the viewport — the overlay
// and the panel background would stop just below the topbar and the nav items
// would spill down over the page.
export function MobileNav({
  restaurantName,
  role,
}: {
  restaurantName: string;
  role: MemberRole;
}) {
  const [open, setOpen] = useState(false);
  // document.body only exists in the browser, so the portal is skipped on the
  // server and on the hydrating pass.
  const mounted = useMounted();

  const drawer = (
      <div
        className={cn(
          "fixed inset-0 z-40 lg:hidden",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!open}
        inert={!open}
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
            "absolute left-0 top-0 flex h-full w-72 max-w-[80%] flex-col gap-4 overflow-hidden bg-white p-4 shadow-xl transition-transform dark:bg-neutral-900",
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
          {/* The nav scrolls, not the panel: `min-h-0` is what lets a flex
              child shrink below its content height. Without it the items
              overflow `h-full` and paint over the page behind the drawer. */}
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            <SidebarNav role={role} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      </div>
  );

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
      {mounted ? createPortal(drawer, document.body) : null}
    </>
  );
}
