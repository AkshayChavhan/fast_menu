"use client";

import { useState } from "react";
import { CalendarRange, Loader2, SlidersHorizontal, Star } from "lucide-react";
import type { Category, Dish, ModifierGroupWithOptions } from "@/types/db";
import { ALLERGENS, DIETARY_TAGS } from "@/lib/constants";
import { Modal } from "@/components/dashboard/Modal";
import { ChipSelect } from "@/components/dashboard/ChipSelect";
import { Switch } from "@/components/dashboard/Switch";
import { ImageUpload } from "@/components/dashboard/ImageUpload";
import {
  ModifierGroupsEditor,
  draftsFromGroups,
  draftsToPayload,
  type DraftGroup,
} from "./ModifierGroupsEditor";
import {
  createDish,
  updateDish,
  setDishModifiers,
} from "@/app/dashboard/menu/actions";

// Payload the form submits; kept aligned with the create/update server actions.
type DishInput = {
  name: string;
  description: string | null;
  price: string;
  categoryId: string | null;
  allergens: string[];
  dietaryTags: string[];
  isFeatured: boolean;
  imageUrl: string | null;
  specialFrom: string | null;
  specialUntil: string | null;
};

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function DishForm({
  open,
  onClose,
  restaurantId,
  categories,
  dish,
  defaultCategoryId,
  modifierGroups,
}: {
  open: boolean;
  onClose: () => void;
  restaurantId: string;
  categories: Category[];
  dish?: Dish | null;
  defaultCategoryId?: string | null;
  /** Existing variants and add-ons of `dish`, when editing. */
  modifierGroups?: ModifierGroupWithOptions[];
}) {
  const editing = !!dish;

  const [name, setName] = useState(dish?.name ?? "");
  const [description, setDescription] = useState(dish?.description ?? "");
  const [price, setPrice] = useState(
    dish ? centsToDollars(dish.price_cents) : "",
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    dish?.category_id ?? defaultCategoryId ?? null,
  );
  const [allergens, setAllergens] = useState<string[]>(dish?.allergens ?? []);
  const [dietaryTags, setDietaryTags] = useState<string[]>(
    dish?.dietary_tags ?? [],
  );
  const [isFeatured, setIsFeatured] = useState(dish?.is_featured ?? false);
  const [imageUrl, setImageUrl] = useState<string | null>(
    dish?.image_url ?? null,
  );
  const [groups, setGroups] = useState<DraftGroup[]>(() =>
    draftsFromGroups(modifierGroups ?? []),
  );
  const [specialFrom, setSpecialFrom] = useState(dish?.special_from ?? "");
  const [specialUntil, setSpecialUntil] = useState(dish?.special_until ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasVariants = groups.some((g) => g.kind === "variant");

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Dish name is required");
      return;
    }
    setSubmitting(true);

    const payload: DishInput = {
      name: name.trim(),
      description: description.trim() || null,
      price: price.trim() === "" ? "0" : price.trim(),
      categoryId,
      allergens,
      dietaryTags,
      isFeatured,
      imageUrl,
      specialFrom: specialFrom || null,
      specialUntil: specialUntil || null,
    };

    let dishId: string;
    if (editing && dish) {
      const res = await updateDish({ dishId: dish.id, ...payload });
      if (!res.ok) {
        setSubmitting(false);
        setError(res.error);
        return;
      }
      dishId = dish.id;
    } else {
      const res = await createDish({ restaurantId, ...payload });
      if (!res.ok) {
        setSubmitting(false);
        setError(res.error);
        return;
      }
      dishId = res.data.id;
    }

    // Variants and add-ons are saved as a whole once the dish exists. A new
    // dish with no groups skips the call entirely.
    if (editing || groups.length > 0) {
      const mods = await setDishModifiers({
        dishId,
        groups: draftsToPayload(groups),
      });
      if (!mods.ok) {
        setSubmitting(false);
        setError(`The dish was saved, but not its options: ${mods.error}`);
        return;
      }
    }

    setSubmitting(false);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit dish" : "Add dish"}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : "Add dish"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        <ImageUpload
          pathPrefix={restaurantId}
          value={imageUrl}
          onChange={setImageUrl}
          label="photo"
        />

        <Field label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Margherita Pizza"
            className={inputClass}
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={hasVariants ? "Price (unused with sizes)" : "Price"}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">
                $
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className={inputClass + " pl-6"}
              />
            </div>
          </Field>
          <Field label="Category">
            <select
              value={categoryId ?? ""}
              onChange={(e) => setCategoryId(e.target.value || null)}
              className={inputClass}
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="San Marzano tomatoes, fresh mozzarella, basil."
            className={inputClass + " resize-y"}
          />
        </Field>

        <Field label="Allergens">
          <ChipSelect
            options={ALLERGENS}
            value={allergens}
            onChange={setAllergens}
          />
        </Field>

        <Field label="Dietary tags">
          <ChipSelect
            options={DIETARY_TAGS}
            value={dietaryTags}
            onChange={setDietaryTags}
            tone="amber"
          />
        </Field>

        <label className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2.5 dark:border-neutral-700">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Star className="h-4 w-4 text-amber-500" />
            Feature this dish
          </span>
          <Switch
            checked={isFeatured}
            onChange={setIsFeatured}
            size="sm"
            label="Feature this dish"
          />
        </label>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-neutral-400" aria-hidden />
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
              Daily special
            </span>
          </div>
          <p className="mb-2 text-[11px] text-neutral-400">
            Give the dish a date window and it is highlighted under Today&apos;s
            specials while the window is on, and hidden outside it. Leave both
            empty for an everyday dish.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <input
                type="date"
                value={specialFrom}
                onChange={(e) => setSpecialFrom(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Until">
              <input
                type="date"
                value={specialUntil}
                min={specialFrom || undefined}
                onChange={(e) => setSpecialUntil(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-neutral-400" aria-hidden />
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
              Sizes, variants &amp; add-ons
            </span>
          </div>
          <p className="mb-2 text-[11px] text-neutral-400">
            Only what you add here is offered. Half / full plates, spice level,
            extra toppings — leave empty for a dish that is ordered as is.
          </p>
          <ModifierGroupsEditor value={groups} onChange={setGroups} />
        </div>
      </div>
    </Modal>
  );
}

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
