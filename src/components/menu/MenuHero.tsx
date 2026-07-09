import Image from "next/image";
import { UtensilsCrossed } from "lucide-react";

// Warm welcome banner beneath the sticky header: large logo, restaurant name
// and description on a soft brand gradient. Purely presentational.
export function MenuHero({
  name,
  description,
  logoUrl,
}: {
  name: string;
  description: string | null;
  logoUrl: string | null;
}) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 via-brand-50/40 to-transparent dark:from-brand-950/40 dark:via-brand-950/10">
      {/* soft decorative glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-brand-200/40 blur-3xl dark:bg-brand-800/20"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 top-0 h-56 w-56 rounded-full bg-amber-200/40 blur-3xl dark:bg-amber-900/20"
      />
      <div className="relative mx-auto flex max-w-5xl flex-col items-center px-4 py-9 text-center sm:py-12">
        <div className="relative mb-4 h-20 w-20 overflow-hidden rounded-2xl bg-white shadow-lg shadow-brand-900/10 ring-1 ring-brand-200/60 dark:bg-neutral-900 dark:ring-brand-900/50 sm:h-24 sm:w-24">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={`${name} logo`}
              fill
              sizes="96px"
              className="object-cover"
              priority
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-brand-400">
              <UtensilsCrossed className="h-9 w-9" aria-hidden />
            </div>
          )}
        </div>
        <h1 className="text-3xl font-black tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
          {name}
        </h1>
        {description && (
          <p className="mt-3 max-w-2xl text-pretty text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
            {description}
          </p>
        )}
        <div
          aria-hidden
          className="mt-6 h-1 w-16 rounded-full bg-gradient-to-r from-brand-400 to-brand-600"
        />
      </div>
    </section>
  );
}
