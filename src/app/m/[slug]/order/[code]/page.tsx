import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getSiteOrigin, publicMenuPath, tableMenuPath } from "@/lib/site";
import type { PublicOrder, Restaurant } from "@/types/db";
import { CartProvider } from "@/components/ordering/CartProvider";
import { OrderStatus } from "@/components/ordering/OrderStatus";

// Live status: never cached, and the client re-fetches every few seconds
// while the order is still moving.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
};

export default async function OrderRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; code: string }>;
  searchParams: Promise<{ t?: string; lang?: string }>;
}) {
  const { slug, code } = await params;
  const { t, lang } = await searchParams;

  const supabase = await createClient();
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Restaurant>();
  if (!restaurant) notFound();

  const { data } = await supabase.rpc("get_order_by_code", {
    p_slug: slug,
    p_code: code,
  });
  const order = data as PublicOrder | null;
  if (!order) notFound();

  const origin = await getSiteOrigin();
  const locale =
    lang && restaurant.locales.includes(lang) ? lang : restaurant.default_locale;
  const menuHref = t ? tableMenuPath(restaurant.slug, t) : publicMenuPath(restaurant.slug);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="sticky top-0 z-40 border-b border-neutral-200/70 bg-white/85 backdrop-blur-md dark:border-neutral-800/70 dark:bg-neutral-950/85">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <Link
            href={menuHref}
            aria-label="Back to the menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-extrabold tracking-tight">Your order</h1>
            <p className="truncate text-xs text-neutral-500">{restaurant.name}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-5">
        <CartProvider slug={restaurant.slug}>
          <OrderStatus
            order={order}
            slug={restaurant.slug}
            locale={locale}
            scanUrl={`${origin}/waiter/scan?code=${encodeURIComponent(order.code)}`}
            menuHref={menuHref}
            tableToken={t ?? null}
            googleReviewUrl={restaurant.google_review_url}
            restaurantName={restaurant.name}
          />
        </CartProvider>
      </main>
    </div>
  );
}
