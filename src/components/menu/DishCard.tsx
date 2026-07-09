import Image from "next/image";
import { UtensilsCrossed, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { AllergenBadge, DietaryBadge } from "./badges";
import { PairingRow } from "./PairingRow";
import type { DishView } from "./types";

// A single dish. Photo-forward, appetizing, generous spacing. Featured dishes
// get a warm brand-tinted frame and a "Chef's Special" ribbon; 86'd dishes are
// dimmed with an "Unavailable" overlay but remain visible for transparency.
export function DishCard({ dish }: { dish: DishView }) {
  // Non chef-special dietary tags render as badges; chef-special is shown as a
  // ribbon on the photo instead, so we filter it out of the badge row.
  const dietaryBadges = dish.dietaryTags.filter((t) => t !== "chef-special");

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-3xl border bg-white shadow-sm ring-1 ring-black/[0.02] transition duration-300 hover:shadow-xl hover:shadow-brand-500/5 dark:bg-neutral-900",
        dish.isFeatured
          ? "border-brand-200 shadow-brand-500/10 dark:border-brand-800/70"
          : "border-neutral-200/80 dark:border-neutral-800",
        !dish.isAvailable && "opacity-75",
      )}
    >
      {dish.imageUrl && (
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-neutral-100 dark:bg-neutral-800">
          <Image
            src={dish.imageUrl}
            alt={dish.name}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className={cn(
              "object-cover transition duration-500 group-hover:scale-[1.04]",
              !dish.isAvailable && "grayscale",
            )}
          />
          {dish.isChefSpecial && (
            <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-lg shadow-brand-900/20 backdrop-blur">
              <Star className="h-3 w-3 fill-current" aria-hidden />
              Chef&apos;s Special
            </span>
          )}
          {!dish.isAvailable && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/45">
              <span className="rounded-full bg-white/95 px-4 py-1.5 text-sm font-bold uppercase tracking-wide text-neutral-800 shadow">
                Unavailable
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-bold leading-snug text-neutral-900 dark:text-neutral-50">
            {dish.name}
            {!dish.imageUrl && dish.isChefSpecial && (
              <span className="ml-2 inline-flex items-center gap-1 align-middle rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">
                <Star className="h-2.5 w-2.5 fill-current" aria-hidden />
                Special
              </span>
            )}
          </h3>
          <div className="shrink-0 whitespace-nowrap rounded-full bg-brand-50 px-3 py-1 text-sm font-extrabold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
            {dish.priceLabel}
          </div>
        </div>

        {dish.description && (
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            {dish.description}
          </p>
        )}

        {(dietaryBadges.length > 0 || dish.allergens.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {dietaryBadges.map((tag) => (
              <DietaryBadge key={tag} tag={tag} />
            ))}
            {dish.allergens.map((a) => (
              <AllergenBadge key={a} allergen={a} />
            ))}
          </div>
        )}

        {!dish.imageUrl && !dish.isAvailable && (
          <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            <UtensilsCrossed className="h-3 w-3" aria-hidden />
            Currently unavailable
          </span>
        )}

        <PairingRow pairings={dish.pairings} />
      </div>
    </article>
  );
}
