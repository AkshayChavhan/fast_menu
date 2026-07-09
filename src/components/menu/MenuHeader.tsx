import Image from "next/image";
import { UtensilsCrossed } from "lucide-react";
import { LanguageSwitcher } from "./LanguageSwitcher";

// Sticky top bar: logo + restaurant name, with an optional language switcher.
// Compact so it leaves room for the menu; the CategoryNav sticks just below it.
export function MenuHeader({
  name,
  logoUrl,
  locales,
  activeLocale,
}: {
  name: string;
  logoUrl: string | null;
  locales: string[];
  activeLocale: string;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200/70 bg-white/85 backdrop-blur-md dark:border-neutral-800/70 dark:bg-neutral-950/85">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5 sm:py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-brand-100 ring-1 ring-brand-200/60 dark:bg-brand-950/60 dark:ring-brand-900/60 sm:h-10 sm:w-10">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={`${name} logo`}
                fill
                sizes="40px"
                className="object-cover"
                priority
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-brand-500">
                <UtensilsCrossed className="h-5 w-5" aria-hidden />
              </div>
            )}
          </div>
          <h1 className="truncate text-base font-extrabold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-lg">
            {name}
          </h1>
        </div>

        {locales.length > 1 && (
          <LanguageSwitcher locales={locales} active={activeLocale} />
        )}
      </div>
    </header>
  );
}
