"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  UtensilsCrossed,
  Settings,
  QrCode,
  Star,
  FileUp,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavLeaf = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

type NavGroup = {
  label: string;
  icon: LucideIcon;
  /** Prefix that marks this group (and any child) as the active section. */
  match: string;
  children: { href: string; label: string; exact?: boolean }[];
};

type NavItem = NavLeaf | NavGroup;

const isGroup = (item: NavItem): item is NavGroup => "children" in item;

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/dashboard/qr", label: "Preview & QR", icon: QrCode },
  { href: "/dashboard/import", label: "Import / Export", icon: FileUp },
  {
    label: "Review",
    icon: Star,
    match: "/dashboard/reviews",
    children: [
      { href: "/dashboard/reviews", label: "Reviews", exact: true },
      { href: "/dashboard/reviews/settings", label: "Review Settings" },
    ],
  },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const linkBase =
  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors";
const activeCls =
  "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300";
const idleCls =
  "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        if (!isGroup(item)) {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(linkBase, active ? activeCls : idleCls)}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        }
        return (
          <NavGroupItem
            key={item.label}
            group={item}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        );
      })}
    </nav>
  );
}

function NavGroupItem({
  group,
  pathname,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  onNavigate?: () => void;
}) {
  const sectionActive = pathname.startsWith(group.match);
  // Opens automatically when you're inside the section; the toggle then lets
  // you collapse it again, so `open` is seeded from the route but not bound
  // to it.
  const [open, setOpen] = useState(sectionActive);
  const expanded = open || sectionActive;
  const Icon = group.icon;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          linkBase,
          "w-full",
          sectionActive ? activeCls : idleCls,
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {group.label}
        <ChevronDown
          aria-hidden
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 transition-transform",
            expanded ? "rotate-180" : "rotate-0",
          )}
        />
      </button>

      {expanded ? (
        // Indented rail mirrors the icon column above it.
        <div className="mt-1 flex flex-col gap-0.5 border-l border-neutral-200 pl-3 ml-[1.4rem] dark:border-neutral-800">
          {group.children.map((child) => {
            const active = child.exact
              ? pathname === child.href
              : pathname.startsWith(child.href);
            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={onNavigate}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "font-medium text-brand-700 dark:text-brand-300"
                    : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
                )}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
