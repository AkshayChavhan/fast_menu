"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2, Star, Loader2, ImageIcon } from "lucide-react";
import type { Dish } from "@/types/db";
import { formatPrice, cn } from "@/lib/utils";
import { labelize } from "@/components/dashboard/ChipSelect";
import { Switch } from "@/components/dashboard/Switch";
import {
  toggleDishAvailability,
  deleteDish,
} from "@/app/dashboard/menu/actions";

export function DishCard({
  dish,
  currency,
  locale,
  onEdit,
}: {
  dish: Dish;
  currency: string;
  locale: string;
  onEdit: () => void;
}) {
  const [available, setAvailable] = useState(dish.is_available);
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(next: boolean) {
    setError(null);
    setAvailable(next); // optimistic
    startTransition(async () => {
      const res = await toggleDishAvailability({
        dishId: dish.id,
        isAvailable: next,
      });
      if (!res.ok) {
        setAvailable(!next);
        setError(res.error);
      }
    });
  }

  async function remove() {
    if (!confirm(`Delete "${dish.name}"? This cannot be undone.`)) return;
    setError(null);
    setDeleting(true);
    const res = await deleteDish({ dishId: dish.id });
    if (!res.ok) {
      setDeleting(false);
      setError(res.error);
    }
    // On success the row disappears via revalidation.
  }

  const dimmed = !available;

  return (
    <div
      className={cn(
        "group relative flex gap-3 rounded-xl border bg-white p-3 transition dark:bg-neutral-900",
        dimmed
          ? "border-red-200 dark:border-red-900/40"
          : "border-neutral-200 dark:border-neutral-800",
        deleting && "pointer-events-none opacity-40",
      )}
    >
      {/* Thumbnail */}
      <div
        className={cn(
          "relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800",
          dimmed && "opacity-50 grayscale",
        )}
      >
        {dish.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dish.image_url}
            alt={dish.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-neutral-300">
            <ImageIcon className="h-5 w-5" />
          </div>
        )}
      </div>

      {/* Body */}
      <div className={cn("min-w-0 flex-1", dimmed && "opacity-60")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="truncate text-sm font-semibold">{dish.name}</h4>
              {dish.is_featured && (
                <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
              )}
              {dimmed && (
                <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700 dark:bg-red-900/40 dark:text-red-300">
                  86&apos;d
                </span>
              )}
            </div>
            {dish.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">
                {dish.description}
              </p>
            )}
            {(dish.allergens.length > 0 || dish.dietary_tags.length > 0) && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {dish.dietary_tags.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                  >
                    {labelize(t)}
                  </span>
                ))}
                {dish.allergens.map((a) => (
                  <span
                    key={a}
                    className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800"
                  >
                    {labelize(a)}
                  </span>
                ))}
              </div>
            )}
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {formatPrice(dish.price_cents, currency, locale)}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit dish"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={remove}
            aria-label="Delete dish"
            disabled={deleting}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* Prominent 86 switch */}
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-[10px] font-semibold uppercase tracking-wide",
              available ? "text-green-600" : "text-red-600",
            )}
          >
            {available ? "On" : "86"}
          </span>
          <Switch
            checked={available}
            onChange={toggle}
            disabled={pending}
            size="sm"
            tone="green"
            label={available ? "Mark as 86'd" : "Mark available"}
          />
        </div>
      </div>

      {error && (
        <p className="absolute -bottom-4 right-2 text-[10px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
