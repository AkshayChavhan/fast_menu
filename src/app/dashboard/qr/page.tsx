import Link from "next/link";
import { redirect } from "next/navigation";
import { QrCode } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import type { Restaurant } from "@/types/db";
import QrStudio from "@/components/qr/QrStudio";

export const metadata = {
  title: "QR code & share assets — fast_menu",
};

// Server component: loads the signed-in owner's active restaurant and computes
// the public menu URL, then hands off to the interactive <QrStudio /> client.
//
// The public URL is `${NEXT_PUBLIC_SITE_URL}/m/<slug>`. If NEXT_PUBLIC_SITE_URL
// is unset we pass a relative `/m/<slug>` path and let the client resolve it
// against window.location.origin (see QrStudio).
export default async function QrPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // "Active restaurant" = the owner's most recently updated restaurant.
  // RLS (restaurants_owner_all) scopes this to rows this user owns.
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<Restaurant>();

  if (!restaurant) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
          <QrCode className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold">No restaurant yet</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Create a restaurant first, then come back to generate its QR code and
          print-ready share assets.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Back to dashboard
        </Link>
      </main>
    );
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  const menuPath = `/m/${restaurant.slug}`;
  // Absolute when we know the origin; relative otherwise (client resolves it).
  const menuUrl = siteUrl ? `${siteUrl}${menuPath}` : menuPath;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-brand-600">
          <QrCode className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Share assets
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
          Table tents, stickers &amp; window decals
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-500">
          Every guest scans one code and lands on your live menu. Download the
          QR, or print a ready-made table tent or sticker sheet below.
          {restaurant.is_published ? null : (
            <span className="mt-2 block rounded-md bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              Heads up: this menu isn&apos;t published yet, so guests who scan
              will see nothing until you publish it.
            </span>
          )}
        </p>
      </header>

      <QrStudio
        menuUrl={menuUrl}
        menuPath={menuPath}
        hasAbsoluteUrl={Boolean(siteUrl)}
        restaurantName={restaurant.name}
      />
    </main>
  );
}
