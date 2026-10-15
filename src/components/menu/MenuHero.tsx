import Image from "next/image";
import { UtensilsCrossed } from "lucide-react";

import { HeroVideo } from "@/components/menu/HeroVideo";
import { cn } from "@/lib/utils";

// Warm welcome banner beneath the sticky header: large logo, restaurant name
// and description. On a soft brand gradient by default; when the restaurant
// has uploaded a clip, the clip plays behind the text under a dark gradient
// — heavier at the top, lighter at the bottom — so the words stay readable
// over whatever the picture is doing. Purely presentational.
export function MenuHero({
  name,
  description,
  logoUrl,
  videoUrl = null,
}: {
  name: string;
  description: string | null;
  logoUrl: string | null;
  videoUrl?: string | null;
}) {
  const withVideo = Boolean(videoUrl);

  return (
    <section
      className={cn(
        "relative overflow-hidden",
        withVideo
          ? "bg-neutral-900"
          : "bg-gradient-to-b from-brand-50 via-brand-50/40 to-transparent dark:from-brand-950/40 dark:via-brand-950/10",
      )}
    >
      {withVideo ? (
        <>
          <HeroVideo src={videoUrl!} />
          {/* 70% dark at the top down to 30% at the bottom: the text sits on
              the darker end, and the picture shows through toward the menu. */}
          <div
            aria-hidden
            data-testid="hero-shade"
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 to-black/30"
          />
        </>
      ) : (
        <>
          {/* soft decorative glows */}
          <div
            aria-hidden
            className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-brand-200/40 blur-3xl dark:bg-brand-800/20"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 top-0 h-56 w-56 rounded-full bg-amber-200/40 blur-3xl dark:bg-amber-900/20"
          />
        </>
      )}
      <div
        className={cn(
          "relative mx-auto flex max-w-5xl flex-col items-center px-4 text-center",
          withVideo ? "min-h-[22rem] justify-center py-12 sm:min-h-[26rem] sm:py-16" : "py-9 sm:py-12",
        )}
      >
        <div
          className={cn(
            "relative mb-4 h-20 w-20 overflow-hidden rounded-2xl bg-white shadow-lg ring-1 dark:bg-neutral-900 sm:h-24 sm:w-24",
            withVideo
              ? "shadow-black/40 ring-white/30"
              : "shadow-brand-900/10 ring-brand-200/60 dark:ring-brand-900/50",
          )}
        >
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
        <h1
          className={cn(
            "text-3xl font-black tracking-tight sm:text-4xl",
            withVideo
              ? "text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.6)]"
              : "text-neutral-900 dark:text-neutral-50",
          )}
        >
          {name}
        </h1>
        {description && (
          <p
            className={cn(
              "mt-3 max-w-2xl text-pretty text-base leading-relaxed",
              withVideo
                ? "text-neutral-100 [text-shadow:0_1px_8px_rgba(0,0,0,0.6)]"
                : "text-neutral-600 dark:text-neutral-300",
            )}
          >
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
