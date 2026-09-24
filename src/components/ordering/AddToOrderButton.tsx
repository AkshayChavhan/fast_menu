"use client";

import { useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DishView } from "@/components/menu/types";
import { OrderSheet } from "./OrderSheet";
import { useCart } from "./CartProvider";

// "Add" on a dish card. A dish with sizes or add-ons opens the sheet; a plain
// dish is added straight away with a brief tick.
export function AddToOrderButton({
  dish,
  currency,
  locale,
  disabled,
}: {
  dish: DishView;
  currency: string;
  locale: string;
  disabled?: boolean;
}) {
  const { add, cart } = useCart();
  const [open, setOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const inCart = cart.lines
    .filter((l) => l.dishId === dish.id)
    .reduce((n, l) => n + l.quantity, 0);

  useEffect(() => {
    if (!justAdded) return;
    const t = setTimeout(() => setJustAdded(false), 1200);
    return () => clearTimeout(t);
  }, [justAdded]);

  function click() {
    if (dish.hasChoices) {
      setOpen(true);
      return;
    }
    add({
      dishId: dish.id,
      name: dish.name,
      unitPriceCents: dish.priceCents,
      note: null,
      variantOptionId: null,
      addonOptionIds: [],
      optionSummary: "",
    });
    setJustAdded(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={click}
        disabled={disabled}
        aria-label={`Add ${dish.name} to your order`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50",
          justAdded
            ? "bg-green-600 text-white"
            : "bg-brand-600 text-white hover:bg-brand-700",
        )}
      >
        {justAdded ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
        {justAdded ? "Added" : inCart > 0 ? `Add · ${inCart} in order` : "Add"}
      </button>
      {open ? (
        <OrderSheet
          key={dish.id}
          dish={dish}
          currency={currency}
          locale={locale}
          open={open}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
