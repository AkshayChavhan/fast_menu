import Link from "next/link";
import {
  UtensilsCrossed,
  FolderTree,
  QrCode,
  ExternalLink,
  Pencil,
  Star,
  Ban,
} from "lucide-react";
import { getActiveContext } from "./lib";
import { createClient } from "@/lib/supabase/server";
import { getSiteOrigin, publicMenuPath } from "@/lib/site";
import { PublishToggle } from "@/components/dashboard/PublishToggle";
import { CopyUrl } from "@/components/dashboard/CopyUrl";

export default async function OverviewPage() {
  const { restaurant } = await getActiveContext();
  const supabase = await createClient();

  const [categoriesRes, dishesRes, origin] = await Promise.all([
    supabase
      .from("categories")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurant.id),
    supabase
      .from("dishes")
      .select("is_available, is_featured", { count: "exact" })
      .eq("restaurant_id", restaurant.id),
    getSiteOrigin(),
  ]);

  const categoryCount = categoriesRes.count ?? 0;
  const dishes = dishesRes.data ?? [];
  const dishCount = dishesRes.count ?? dishes.length;
  const eightySixed = dishes.filter((d) => d.is_available === false).length;
  const featured = dishes.filter((d) => d.is_featured === true).length;

  const menuUrl = `${origin}${publicMenuPath(restaurant.slug)}`;

  const stats = [
    {
      label: "Categories",
      value: categoryCount,
      icon: FolderTree,
      accent: "text-brand-600 bg-brand-50 dark:bg-brand-900/30 dark:text-brand-300",
    },
    {
      label: "Dishes",
      value: dishCount,
      icon: UtensilsCrossed,
      accent: "text-brand-600 bg-brand-50 dark:bg-brand-900/30 dark:text-brand-300",
    },
    {
      label: "Featured",
      value: featured,
      icon: Star,
      accent:
        "text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300",
    },
    {
      label: "86'd",
      value: eightySixed,
      icon: Ban,
      accent: "text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-sm text-neutral-500">
          A snapshot of {restaurant.name}.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, accent }) => (
          <div
            key={label}
            className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div
              className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="text-2xl font-bold tabular-nums">{value}</div>
            <div className="text-xs text-neutral-500">{label}</div>
          </div>
        ))}
      </div>

      {/* Publish card */}
      <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <PublishToggle
          restaurantId={restaurant.id}
          initial={restaurant.is_published}
        />
        <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Public menu URL
          </p>
          <CopyUrl url={menuUrl} />
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={menuUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open menu
            </a>
            <Link
              href="/dashboard/qr"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <QrCode className="h-3.5 w-3.5" /> QR code
            </Link>
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/dashboard/menu"
          className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-brand-700"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            <Pencil className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Edit menu</span>
            <span className="block text-xs text-neutral-500">
              Categories, dishes, prices &amp; 86 items
            </span>
          </span>
        </Link>
        <Link
          href="/dashboard/settings"
          className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-brand-700"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            <UtensilsCrossed className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Restaurant settings</span>
            <span className="block text-xs text-neutral-500">
              Name, slug, currency, languages &amp; logo
            </span>
          </span>
        </Link>
      </section>
    </div>
  );
}
