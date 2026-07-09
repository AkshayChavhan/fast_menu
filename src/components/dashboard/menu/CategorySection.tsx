"use client";

import { useState, useTransition } from "react";
import {
  ChevronUp,
  ChevronDown,
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
  Loader2,
  GripVertical,
} from "lucide-react";
import type { Category, Dish } from "@/types/db";
import { cn } from "@/lib/utils";
import { DishCard } from "./DishCard";
import {
  updateCategory,
  deleteCategory,
} from "@/app/dashboard/menu/actions";

export function CategorySection({
  category,
  dishes,
  currency,
  locale,
  isFirst,
  isLast,
  reordering,
  onMove,
  onAddDish,
  onEditDish,
}: {
  category: Category | null; // null = the "Uncategorized" bucket
  dishes: Dish[];
  currency: string;
  locale: string;
  isFirst: boolean;
  isLast: boolean;
  reordering: boolean;
  onMove: (dir: -1 | 1) => void;
  onAddDish: () => void;
  onEditDish: (dish: Dish) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);

  const isRealCategory = category !== null;

  function saveName() {
    if (!category) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name required");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await updateCategory({
        categoryId: category.id,
        name: trimmed,
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        setEditing(false);
      }
    });
  }

  async function remove() {
    if (!category) return;
    if (
      !confirm(
        `Delete category "${category.name}"? Its dishes will move to Uncategorized.`,
      )
    )
      return;
    setDeleting(true);
    const res = await deleteCategory({ categoryId: category.id });
    if (!res.ok) {
      setDeleting(false);
      setError(res.error);
    }
  }

  return (
    <section
      className={cn(
        "rounded-2xl border border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-900/40",
        deleting && "pointer-events-none opacity-40",
      )}
    >
      <header className="flex items-center gap-2 px-4 py-3">
        {isRealCategory && reordering && (
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={isFirst}
              aria-label="Move category up"
              className="text-neutral-400 hover:text-neutral-700 disabled:opacity-25"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={isLast}
              aria-label="Move category down"
              className="text-neutral-400 hover:text-neutral-700 disabled:opacity-25"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        )}
        {isRealCategory && reordering && (
          <GripVertical className="h-4 w-4 text-neutral-300" />
        )}

        {editing && isRealCategory ? (
          <div className="flex flex-1 items-center gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") {
                  setEditing(false);
                  setName(category!.name);
                }
              }}
              autoFocus
              className="flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm font-semibold outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800"
            />
            <button
              type="button"
              onClick={saveName}
              disabled={pending}
              aria-label="Save name"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(category!.name);
                setError(null);
              }}
              aria-label="Cancel"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <h3 className="flex-1 truncate text-sm font-bold">
            {isRealCategory ? category!.name : "Uncategorized"}
            <span className="ml-2 text-xs font-normal text-neutral-400">
              {dishes.length}
            </span>
          </h3>
        )}

        {isRealCategory && !editing && !reordering && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setName(category!.name);
              }}
              aria-label="Rename category"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={remove}
              aria-label="Delete category"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </header>

      {error && (
        <p className="px-4 pb-1 text-xs text-red-600">{error}</p>
      )}

      <div className="space-y-2 px-4 pb-4">
        {dishes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-200 py-6 text-center text-xs text-neutral-400 dark:border-neutral-800">
            No dishes yet.
          </p>
        ) : (
          dishes.map((dish) => (
            <DishCard
              key={dish.id}
              dish={dish}
              currency={currency}
              locale={locale}
              onEdit={() => onEditDish(dish)}
            />
          ))
        )}

        {!reordering && (
          <button
            type="button"
            onClick={onAddDish}
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-500 hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-600 dark:border-neutral-700 dark:hover:border-brand-600 dark:hover:bg-brand-900/20"
          >
            <Plus className="h-3.5 w-3.5" /> Add dish
          </button>
        )}
      </div>
    </section>
  );
}
