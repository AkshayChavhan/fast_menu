import Image from "next/image";
import { Sparkles, Plus, UtensilsCrossed } from "lucide-react";
import type { PairingView } from "./types";

// "Goes well with" / "Add-ons" upsell strip shown beneath a dish.
// Horizontally scrollable chips with a photo, name and price — designed to
// tempt: warm accent framing, subtle hover lift, snap scrolling on mobile.
export function PairingRow({ pairings }: { pairings: PairingView[] }) {
  if (pairings.length === 0) return null;

  const addons = pairings.filter((p) => p.kind === "addon");
  const goesWith = pairings.filter((p) => p.kind === "pairing");

  return (
    <div className="mt-4 space-y-3 border-t border-dashed border-brand-200/70 pt-4 dark:border-brand-900/60">
      {goesWith.length > 0 && (
        <PairingGroup
          title="Goes well with"
          icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}
          items={goesWith}
        />
      )}
      {addons.length > 0 && (
        <PairingGroup
          title="Make it a meal"
          icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
          items={addons}
        />
      )}
    </div>
  );
}

function PairingGroup({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: PairingView[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
        {icon}
        {title}
      </div>
      <div className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((p) => (
          <div
            key={p.id}
            className="group/pair flex w-40 shrink-0 snap-start items-center gap-2.5 rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50/80 to-white p-2 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-brand-900/60 dark:from-brand-950/40 dark:to-neutral-900"
          >
            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-brand-100 dark:bg-brand-950/60">
              {p.imageUrl ? (
                <Image
                  src={p.imageUrl}
                  alt={p.name}
                  fill
                  sizes="44px"
                  className="object-cover transition duration-300 group-hover/pair:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-brand-400">
                  <UtensilsCrossed className="h-4 w-4" aria-hidden />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-neutral-800 dark:text-neutral-100">
                {p.name}
              </p>
              <p className="text-xs font-bold text-brand-600 dark:text-brand-400">
                {p.priceLabel}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
