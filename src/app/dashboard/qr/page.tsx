import { QrCode } from "lucide-react";

import { getActiveContext } from "../lib";
import { getSiteOrigin, publicMenuPath } from "@/lib/site";
import QrStudio from "@/components/qr/QrStudio";

export const metadata = {
  title: "QR code & share assets — fast_menu",
};

// Server component: loads the signed-in owner's active restaurant (via the
// shared getActiveContext, so it matches the dashboard header and every other
// page) and computes the absolute public menu URL, then hands off to the
// interactive <QrStudio /> client. getSiteOrigin() always resolves an origin
// server-side (env var, VERCEL_URL, or the request host).
export default async function QrPage() {
  const { restaurant } = await getActiveContext();

  const origin = await getSiteOrigin();
  const menuPath = publicMenuPath(restaurant.slug);
  const menuUrl = `${origin}${menuPath}`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
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
        hasAbsoluteUrl={true}
        restaurantName={restaurant.name}
      />
    </div>
  );
}
