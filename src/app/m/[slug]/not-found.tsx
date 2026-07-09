import Link from "next/link";
import { UtensilsCrossed, QrCode, ArrowRight } from "lucide-react";

// Friendly 404 for /m/[slug] — a mistyped slug, an unpublished menu, or a
// restaurant that no longer exists all land here.
export default function MenuNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 via-neutral-50 to-neutral-50 px-4 dark:from-brand-950/30 dark:via-neutral-950 dark:to-neutral-950">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-white shadow-lg shadow-brand-900/10 ring-1 ring-brand-200/60 dark:bg-neutral-900 dark:ring-brand-900/50">
          <UtensilsCrossed className="h-10 w-10 text-brand-500" aria-hidden />
        </div>

        <p className="text-sm font-bold uppercase tracking-widest text-brand-500">
          Menu not found
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-neutral-900 dark:text-neutral-50">
          We couldn’t find this menu
        </h1>
        <p className="mt-3 text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
          The link may be mistyped, or this menu isn’t published yet. Try
          scanning the QR code again, or double-check the address.
        </p>

        <div className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-dashed border-brand-200 bg-brand-50/60 px-4 py-3 text-sm text-brand-700 dark:border-brand-900/60 dark:bg-brand-950/30 dark:text-brand-300">
          <QrCode className="h-5 w-5 shrink-0" aria-hidden />
          <span>Scan the QR code on your table to open the right menu.</span>
        </div>

        <div className="mt-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            Go to fast_menu
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </main>
  );
}
