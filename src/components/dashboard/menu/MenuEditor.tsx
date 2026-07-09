"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  FolderPlus,
  ArrowUpDown,
  Loader2,
  Check,
  UtensilsCrossed,
} from "lucide-react";
import type { Category, Dish } from "@/types/db";
import { cn } from "@/lib/utils";
import { CategorySection } from "./CategorySection";
import { DishForm } from "./DishForm";
import {
  createCategory,
  reorderCategories,
} from "@/app/dashboard/menu/actions";

const UNCATEGORIZED = "__uncategorized__";

export function MenuEditor({
  restaurantId,
  currency,
  defaultLocale,
  initialCategories,
  initialDishes,
}: {
  restaurantId: string;
  currency: string;
  defaultLocale: string;
  initialCategories: Category[];
  initialDishes: Dish[];
}) {
  const router = useRouter();

  // Local order state so category reordering feels instant; server is source of
  // truth on refresh (revalidation reloads the server component).
  const [order, setOrder] = useState<Category[]>(initialCategories);
  const [reordering, setReordering] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [catError, setCatError] = useState<string | null>(null);
  const [catPending, startCatTransition] = useTransition();

  // Dish modal state.
  const [dishModal, setDishModal] = useState<{
    open: boolean;
    dish: Dish | null;
    defaultCategoryId: string | null;
  }>({ open: false, dish: null, defaultCategoryId: null });

  const dishesByCategory = useMemo(() => {
    const map = new Map<string, Dish[]>();
    for (const dish of initialDishes) {
      const key = dish.category_id ?? UNCATEGORIZED;
      const arr = map.get(key);
      if (arr) arr.push(dish);
      else map.set(key, [dish]);
    }
    return map;
  }, [initialDishes]);

  const uncategorized = dishesByCategory.get(UNCATEGORIZED) ?? [];
  const hasNothing = order.length === 0 && initialDishes.length === 0;

  function addCategory() {
    const trimmed = newCatName.trim();
    if (!trimmed) {
      setCatError("Enter a category name");
      return;
    }
    setCatError(null);
    startCatTransition(async () => {
      const res = await createCategory({ restaurantId, name: trimmed });
      if (!res.ok) {
        setCatError(res.error);
        return;
      }
      setNewCatName("");
      setAddingCategory(false);
      router.refresh();
    });
  }

  function moveCategory(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    setOrder((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  }

  async function saveOrder() {
    setSavingOrder(true);
    const res = await reorderCategories({
      restaurantId,
      orderedIds: order.map((c) => c.id),
    });
    setSavingOrder(false);
    setReordering(false);
    if (res.ok) router.refresh();
  }

  function cancelReorder() {
    setOrder(initialCategories);
    setReordering(false);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Menu</h1>
          <p className="text-sm text-neutral-500">
            Organize categories and dishes. Flip a dish off to 86 it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {order.length > 1 &&
            (reordering ? (
              <>
                <button
                  type="button"
                  onClick={cancelReorder}
                  disabled={savingOrder}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveOrder}
                  disabled={savingOrder}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {savingOrder ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Save order
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setReordering(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                <ArrowUpDown className="h-4 w-4" /> Reorder
              </button>
            ))}

          {!reordering && (
            <button
              type="button"
              onClick={() =>
                setDishModal({
                  open: true,
                  dish: null,
                  defaultCategoryId: order[0]?.id ?? null,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <Plus className="h-4 w-4" /> Add dish
            </button>
          )}
        </div>
      </div>

      {/* Add category row */}
      {!reordering && (
        <div>
          {addingCategory ? (
            <div className="flex items-center gap-2">
              <input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCategory();
                  if (e.key === "Escape") {
                    setAddingCategory(false);
                    setNewCatName("");
                    setCatError(null);
                  }
                }}
                autoFocus
                placeholder="Category name (e.g. Starters)"
                className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800"
              />
              <button
                type="button"
                onClick={addCategory}
                disabled={catPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {catPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddingCategory(false);
                  setNewCatName("");
                  setCatError(null);
                }}
                className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingCategory(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600 hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-600 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-brand-600 dark:hover:bg-brand-900/20"
            >
              <FolderPlus className="h-4 w-4" /> Add category
            </button>
          )}
          {catError && <p className="mt-1 text-xs text-red-600">{catError}</p>}
        </div>
      )}

      {/* Empty state */}
      {hasNothing && (
        <div className="rounded-2xl border border-dashed border-neutral-300 py-14 text-center dark:border-neutral-700">
          <UtensilsCrossed className="mx-auto h-8 w-8 text-neutral-300" />
          <h3 className="mt-3 text-sm font-semibold">Your menu is empty</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Start by adding a category, then add dishes to it.
          </p>
          <button
            type="button"
            onClick={() => setAddingCategory(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            <FolderPlus className="h-4 w-4" /> Add your first category
          </button>
        </div>
      )}

      {/* Category sections */}
      <div className={cn("space-y-4")}>
        {order.map((category, i) => (
          <CategorySection
            key={category.id}
            category={category}
            dishes={dishesByCategory.get(category.id) ?? []}
            currency={currency}
            locale={defaultLocale}
            isFirst={i === 0}
            isLast={i === order.length - 1}
            reordering={reordering}
            onMove={(dir) => moveCategory(i, dir)}
            onAddDish={() =>
              setDishModal({
                open: true,
                dish: null,
                defaultCategoryId: category.id,
              })
            }
            onEditDish={(dish) =>
              setDishModal({ open: true, dish, defaultCategoryId: null })
            }
          />
        ))}

        {/* Uncategorized bucket, only when it has dishes */}
        {uncategorized.length > 0 && !reordering && (
          <CategorySection
            category={null}
            dishes={uncategorized}
            currency={currency}
            locale={defaultLocale}
            isFirst={false}
            isLast={false}
            reordering={false}
            onMove={() => {}}
            onAddDish={() =>
              setDishModal({
                open: true,
                dish: null,
                defaultCategoryId: null,
              })
            }
            onEditDish={(dish) =>
              setDishModal({ open: true, dish, defaultCategoryId: null })
            }
          />
        )}
      </div>

      {/* Dish create/edit modal. Keyed so state resets per open target. */}
      {dishModal.open && (
        <DishForm
          key={dishModal.dish?.id ?? "new"}
          open={dishModal.open}
          onClose={() => {
            setDishModal({ open: false, dish: null, defaultCategoryId: null });
            router.refresh();
          }}
          restaurantId={restaurantId}
          categories={order}
          dish={dishModal.dish}
          defaultCategoryId={dishModal.defaultCategoryId}
        />
      )}
    </div>
  );
}
