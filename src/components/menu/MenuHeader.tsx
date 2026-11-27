"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { UtensilsCrossed } from "lucide-react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { cn } from "@/lib/utils";

// The id MenuHero puts on its banner; the header watches that element.
export const MENU_HERO_ID = "menu-hero";

// Compact top bar: logo + restaurant name, with the language switcher.
//
// Hidden while the welcome banner is on screen. The banner already shows the
// logo and name in large, so repeating them above it is noise. Once the
// banner's bottom edge scrolls past the top of the screen the bar slides in,
// and it slides away again when the guest scrolls back up.
//
// It overlays the page (fixed) rather than taking space, so there's no empty
// strip above the banner on load. The CategoryNav sticks 57px down, which it
// only reaches after the banner is gone and this bar is showing.
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
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const hero = document.getElementById(MENU_HERO_ID);
    if (!hero || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      // Out of view *above* the screen. A banner below the screen (a deep
      // link that opened lower down, then a jump back) doesn't count.
      setShown(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
    });
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  return (
    <header
      data-shown={shown}
      aria-hidden={!shown}
      inert={!shown}
      className={cn(
        "fixed inset-x-0 top-0 z-40 border-b border-neutral-200/70 bg-white/85 backdrop-blur-md transition duration-300 ease-out motion-reduce:transition-none dark:border-neutral-800/70 dark:bg-neutral-950/85",
        shown ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0",
      )}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5 sm:py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-brand-100 ring-1 ring-brand-200/60 dark:bg-brand-950/60 dark:ring-brand-900/60 sm:h-10 sm:w-10">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt=""
                fill
                sizes="40px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-brand-500">
                <UtensilsCrossed className="h-5 w-5" aria-hidden />
              </div>
            )}
          </div>
          {/* Not a heading: the banner's <h1> is the page title. */}
          <p className="truncate text-base font-extrabold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-lg">
            {name}
          </p>
        </div>

        {locales.length > 1 && (
          <LanguageSwitcher locales={locales} active={activeLocale} />
        )}
      </div>
    </header>
  );
}
