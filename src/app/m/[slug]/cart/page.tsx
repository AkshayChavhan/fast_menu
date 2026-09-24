import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { publicMenuPath, tableMenuPath } from "@/lib/site";
import type { Restaurant } from "@/types/db";
import { CartProvider } from "@/components/ordering/CartProvider";
import { CartPage } from "@/components/ordering/CartPage";

// The cart is the guest's own, read from their browser; nothing here is
// cacheable.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
};

export default async function CartRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string; lang?: string }>;
}) {
  const { slug } = await params;
  const { t, lang } = await searchParams;

  const supabase = await createClient();
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Restaurant>();
  if (!restaurant || !restaurant.ordering_enabled) notFound();

  const { data: table } = t
    ? await supabase
        .from("tables")
        .select("label, qr_token")
        .eq("restaurant_id", restaurant.id)
        .eq("qr_token", t)
        .eq("is_active", true)
        .maybeSingle<{ label: string; qr_token: string }>()
    : { data: null };

  const locale =
    lang && restaurant.locales.includes(lang) ? lang : restaurant.default_locale;
  const backHref = table
    ? tableMenuPath(restaurant.slug, table.qr_token)
    : publicMenuPath(restaurant.slug);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="sticky top-0 z-40 border-b border-neutral-200/70 bg-white/85 backdrop-blur-md dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <Link
            href={backHref}
            aria-label="Back to the menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-extrabold tracking-tight">Your order</h1>
            <p className="truncate text-xs text-neutral-500">
              {restaurant.name}
              {table ? ` · ${table.label}` : ""}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-5">
        <CartProvider slug={restaurant.slug}>
          <CartPage
            slug={restaurant.slug}
            currency={restaurant.currency}
            locale={locale}
            tableToken={table?.qr_token ?? null}
            tableLabel={table?.label ?? null}
            allowTakeaway={restaurant.allow_takeaway}
            paused={restaurant.ordering_paused}
            pauseMessage={restaurant.pause_message}
            menuHref={backHref}
          />
        </CartProvider>
      </main>
    </div>
  );
}
