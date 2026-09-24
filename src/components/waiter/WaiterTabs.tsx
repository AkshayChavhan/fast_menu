"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, Plus, ScanLine, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; icon: LucideIcon; exact?: boolean };

// Bottom tab bar for the waiter app. Thumb-reach on a phone; fixed so it
// stays put while a long order list scrolls underneath.
const TABS: Tab[] = [
  { href: "/waiter", label: "Home", icon: Home, exact: true },
  { href: "/waiter/scan", label: "Scan", icon: ScanLine },
  { href: "/waiter/new", label: "New order", icon: Plus },
  { href: "/waiter/tables", label: "Tables", icon: LayoutGrid },
];

export function WaiterTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Waiter"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95"
    >
      <ul className="mx-auto flex max-w-lg">
        {TABS.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors",
                  active
                    ? "text-brand-600 dark:text-brand-300"
                    : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
