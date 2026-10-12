import Link from "next/link";

const PAGES = [
  { key: "activity", href: "/admin", label: "Restaurants" },
  { key: "plans", href: "/admin/plans", label: "Plans" },
  { key: "trials", href: "/admin/trials", label: "Trial reviews" },
] as const;

export type AdminPage = (typeof PAGES)[number]["key"];

// Links to the other operator pages. The current one is left out rather than
// highlighted: each page already says what it is in its heading.
export function AdminNav({ current }: { current: AdminPage }) {
  return (
    <nav aria-label="Platform admin" className="ml-auto flex items-center gap-3">
      {PAGES.filter((p) => p.key !== current).map((p) => (
        <Link
          key={p.key}
          href={p.href}
          className="text-xs font-medium text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
