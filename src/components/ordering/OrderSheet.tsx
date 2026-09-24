"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";

import {
  defaultSelection,
  priceSelection,
  type ModifierSelection,
} from "@/lib/modifiers";
import { formatPrice, cn } from "@/lib/utils";
import type { DishView } from "@/components/menu/types";
import { BottomSheet } from "./BottomSheet";
import { QtyStepper } from "./QtyStepper";
import { useCart } from "./CartProvider";

// The guest picks a size, add-ons, a note and a quantity, sees the live
// price, and adds the line. Validation mirrors what the database enforces.
export function OrderSheet({
  dish,
  currency,
  locale,
  open,
  onClose,
}: {
  dish: DishView;
  currency: string;
  locale: string;
  open: boolean;
  onClose: () => void;
}) {
  const { add } = useCart();
  const [selection, setSelection] = useState<ModifierSelection>(() =>
    defaultSelection(dish.modifierGroups),
  );
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const priced = useMemo(
    () => priceSelection({ price_cents: dish.priceCents }, dish.modifierGroups, selection),
    [dish, selection],
  );

  const price = (cents: number) => formatPrice(cents, currency, locale);

  function pickVariant(groupId: string, optionId: string) {
    setError(null);
    setSelection((s) => ({ ...s, [groupId]: [optionId] }));
  }

  function toggleAddon(groupId: string, optionId: string, max: number | null) {
    setError(null);
    setSelection((s) => {
      const current = s[groupId] ?? [];
      if (current.includes(optionId)) {
        return { ...s, [groupId]: current.filter((id) => id !== optionId) };
      }
      // A single-choice add-on group behaves like a radio.
      if (max === 1) return { ...s, [groupId]: [optionId] };
      if (max !== null && current.length >= max) return s;
      return { ...s, [groupId]: [...current, optionId] };
    });
  }

  function submit() {
    if (!priced.ok) {
      setError(priced.error);
      return;
    }
    const variant = priced.chosen.find((c) => c.kind === "variant");
    const addons = priced.chosen.filter((c) => c.kind === "addon");
    add({
      dishId: dish.id,
      name: dish.name,
      unitPriceCents: priced.unitPriceCents,
      quantity,
      note: note.trim() || null,
      variantOptionId: variant?.optionId ?? null,
      addonOptionIds: addons.map((a) => a.optionId),
      optionSummary: priced.chosen.map((c) => c.name).join(" · "),
    });
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={dish.name}
      footer={
        <div className="flex items-center gap-3">
          <QtyStepper value={quantity} onChange={setQuantity} label={dish.name} />
          <button
            type="button"
            onClick={submit}
            className="flex flex-1 items-center justify-between rounded-full bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700"
          >
            <span>Add to order</span>
            <span translate="no" className="tabular-nums">
              {priced.ok ? price(priced.unitPriceCents * quantity) : "—"}
            </span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {dish.description ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{dish.description}</p>
        ) : null}

        {dish.modifierGroups.map((g) => {
          const options = g.options.filter((o) => o.is_available);
          if (options.length === 0) return null;
          const picked = selection[g.id] ?? [];
          const isVariant = g.kind === "variant";
          const hint = isVariant
            ? "Choose one"
            : g.max_select === 1
              ? g.min_select > 0 ? "Choose one" : "Optional, choose one"
              : g.min_select > 0
                ? `Choose at least ${g.min_select}${g.max_select ? `, up to ${g.max_select}` : ""}`
                : g.max_select
                  ? `Optional, up to ${g.max_select}`
                  : "Optional";
          return (
            <fieldset key={g.id}>
              <legend className="mb-2 flex items-baseline gap-2">
                <span className="text-sm font-bold">{g.name}</span>
                <span className="text-xs text-neutral-500">{hint}</span>
              </legend>
              <div className="space-y-1.5">
                {options.map((o) => {
                  const on = picked.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role={isVariant || g.max_select === 1 ? "radio" : "checkbox"}
                      aria-checked={on}
                      onClick={() =>
                        isVariant ? pickVariant(g.id, o.id) : toggleAddon(g.id, o.id, g.max_select)
                      }
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition",
                        on
                          ? "border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-900/30"
                          : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center border",
                          isVariant || g.max_select === 1 ? "rounded-full" : "rounded-md",
                          on ? "border-brand-600 bg-brand-600 text-white" : "border-neutral-300 dark:border-neutral-600",
                        )}
                        aria-hidden
                      >
                        {on ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      <span className="flex-1 font-medium">{o.name}</span>
                      <span translate="no" className="text-xs text-neutral-500 tabular-nums">
                        {isVariant ? price(o.price_cents) : o.price_cents > 0 ? `+ ${price(o.price_cents)}` : "Free"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        <div>
          <label htmlFor={`note-${dish.id}`} className="mb-1 block text-sm font-bold">
            Anything for the kitchen?{" "}
            <span className="font-normal text-neutral-500">Optional</span>
          </label>
          <input
            id={`note-${dish.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Less spicy, no onion…"
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/20 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}
      </div>
    </BottomSheet>
  );
}
