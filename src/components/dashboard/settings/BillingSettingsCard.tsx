"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Info, Loader2 } from "lucide-react";

import type { Restaurant } from "@/types/db";
import { Switch } from "@/components/dashboard/Switch";
import { updateBillingSettings } from "@/app/dashboard/settings/actions";
import type { ActionResult } from "@/app/dashboard/lib";
import {
  GST_PRESETS,
  computeBill,
  type BillLine,
  type TaxMode,
  type TaxSettings,
} from "@/lib/bill-tax";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";

export interface TaxCategory {
  id: string;
  name: string;
  tax_class: "food" | "liquor";
}

const MODES: { value: TaxMode; title: string; body: string }[] = [
  {
    value: "none",
    title: "Not registered for GST",
    body: "No GST on the bill. Usually a small restaurant under the turnover limit.",
  },
  {
    value: "gst",
    title: "Regular GST",
    body: "GST is added to the bill as CGST + SGST, with your GSTIN.",
  },
  {
    value: "composition",
    title: "Composition scheme",
    body: "You pay GST yourself and may not charge it to guests. The bill says so.",
  },
];

// Basis points -> what the owner types ("5", "2.5"), and back is in the action.
const bpToInput = (bp: number) => (bp ? String(Number((bp / 100).toFixed(2))) : "");
const centsToInput = (c: number) => (c ? String(Number((c / 100).toFixed(2))) : "");
const inputToBp = (s: string) => {
  const n = Number(s.trim().replace("%", ""));
  return s.trim() === "" || !Number.isFinite(n) ? 0 : Math.round(n * 100);
};
const inputToCents = (s: string) => {
  const n = Number(s.trim().replace(/[₹,\s]/g, ""));
  return s.trim() === "" || !Number.isFinite(n) ? 0 : Math.round(n * 100);
};

// Settings -> Bill & taxes. What a restaurant adds on top of its dish prices,
// with a sample bill that follows every change before anything is saved.
export function BillingSettingsCard({
  restaurant,
  categories,
}: {
  restaurant: Restaurant;
  categories: TaxCategory[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    updateBillingSettings,
    null,
  );
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const [mode, setMode] = useState<TaxMode>(restaurant.tax_mode ?? "none");
  const [gstRate, setGstRate] = useState(bpToInput(restaurant.gst_rate_bp ?? 500));
  const [gstin, setGstin] = useState(restaurant.gstin ?? "");
  const [included, setIncluded] = useState(restaurant.prices_include_tax ?? false);
  const [liquorVat, setLiquorVat] = useState(bpToInput(restaurant.liquor_vat_bp ?? 0));
  const [packaging, setPackaging] = useState(centsToInput(restaurant.packaging_cents ?? 0));
  const [roundOff, setRoundOff] = useState(restaurant.round_off ?? true);
  const [liquorIds, setLiquorIds] = useState<Set<string>>(
    () => new Set(categories.filter((c) => c.tax_class === "liquor").map((c) => c.id)),
  );

  const presetBp = inputToBp(gstRate);
  const isPreset = GST_PRESETS.some((p) => p.bp === presetBp);
  const [customRate, setCustomRate] = useState(!isPreset && gstRate !== "");

  const settings: TaxSettings = {
    tax_mode: mode,
    gst_rate_bp: inputToBp(gstRate),
    prices_include_tax: included,
    liquor_vat_bp: inputToBp(liquorVat),
    packaging_cents: inputToCents(packaging),
    round_off: roundOff,
  };

  // A ₹1,000 food order, plus ₹500 of drinks when there is a liquor category.
  const hasLiquor = liquorIds.size > 0;
  const sample = useMemo<BillLine[]>(
    () => [
      { cents: 100000, taxClass: "food" },
      ...(hasLiquor ? [{ cents: 50000, taxClass: "liquor" as const }] : []),
    ],
    [hasLiquor],
  );
  const bill = computeBill(sample, settings);
  const takeaway = computeBill([{ cents: 100000, taxClass: "food" }], settings, { takeaway: true });
  const price = (cents: number) =>
    formatPrice(cents, restaurant.currency, restaurant.default_locale);

  const toggleLiquor = (id: string, on: boolean) =>
    setLiquorIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <form action={formAction}>
      <input type="hidden" name="restaurantId" value={restaurant.id} />
      <input type="hidden" name="tax_mode" value={mode} />
      <input type="hidden" name="gst_rate" value={gstRate} />
      <input type="hidden" name="prices_include_tax" value={String(included)} />
      <input type="hidden" name="round_off" value={String(roundOff)} />
      {[...liquorIds].map((id) => (
        <input key={id} type="hidden" name="liquor_category" value={id} />
      ))}

      <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold">Bill &amp; taxes</h2>
          <p className="text-xs text-neutral-500">
            What is added on top of your dish prices. Check the rates with your CA.
          </p>
        </div>

        <div className="space-y-6 px-5 py-4">
          {/* GST status */}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">GST status</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {MODES.map((m) => (
                <label
                  key={m.value}
                  className={cn(
                    "cursor-pointer rounded-lg border p-3 text-sm transition",
                    mode === m.value
                      ? "border-brand-500 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/30"
                      : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-700",
                  )}
                >
                  <input
                    type="radio"
                    name="tax_mode_choice"
                    value={m.value}
                    checked={mode === m.value}
                    onChange={() => setMode(m.value)}
                    className="sr-only"
                  />
                  <span className="block font-semibold">{m.title}</span>
                  <span className="mt-0.5 block text-xs text-neutral-500">{m.body}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Rate */}
          {mode === "gst" ? (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">GST rate</legend>
              <div className="flex flex-wrap gap-2">
                {GST_PRESETS.map((p) => (
                  <button
                    key={p.bp}
                    type="button"
                    onClick={() => {
                      setCustomRate(false);
                      setGstRate(bpToInput(p.bp));
                    }}
                    aria-pressed={!customRate && presetBp === p.bp}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-sm",
                      !customRate && presetBp === p.bp
                        ? "border-brand-500 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/30"
                        : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-700",
                    )}
                  >
                    <span className="block font-semibold">{p.label}</span>
                    <span className="block text-xs text-neutral-500">{p.hint}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCustomRate(true)}
                  aria-pressed={customRate}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm font-semibold",
                    customRate
                      ? "border-brand-500 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/30"
                      : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-700",
                  )}
                >
                  Other
                </button>
              </div>
              {customRate ? (
                <PercentInput
                  label="GST rate"
                  value={gstRate}
                  onChange={setGstRate}
                  className="mt-2"
                />
              ) : null}
              <p className="mt-2 text-xs text-neutral-500">
                Shown on the bill as two halves: CGST and SGST.
              </p>
            </fieldset>
          ) : null}

          {/* GSTIN */}
          {mode !== "none" ? (
            <label className="block">
              <span className="mb-1 block text-sm font-medium">GSTIN</span>
              <input
                name="gstin"
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="27AAPFU0939F1ZV"
                maxLength={20}
                autoComplete="off"
                spellCheck={false}
                className="w-full max-w-xs rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm tracking-wider dark:border-neutral-700 dark:bg-neutral-900"
              />
              <span className="mt-1 block text-xs text-neutral-500">Printed on every bill.</span>
            </label>
          ) : (
            <input type="hidden" name="gstin" value={gstin} />
          )}

          {/* Inclusive / exclusive */}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Your menu prices</legend>
            <div className="flex flex-wrap gap-2">
              {[
                { v: false, t: "Exclude tax", b: "Tax is added on top of the menu price" },
                { v: true, t: "Include tax", b: "Tax is already inside the menu price" },
              ].map((o) => (
                <label
                  key={String(o.v)}
                  className={cn(
                    "cursor-pointer rounded-lg border px-3 py-2 text-sm",
                    included === o.v
                      ? "border-brand-500 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/30"
                      : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-700",
                  )}
                >
                  <input
                    type="radio"
                    name="included_choice"
                    checked={included === o.v}
                    onChange={() => setIncluded(o.v)}
                    className="sr-only"
                  />
                  <span className="block font-semibold">{o.t}</span>
                  <span className="block text-xs text-neutral-500">{o.b}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Liquor */}
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Liquor</legend>
            <p className="mb-2 text-xs text-neutral-500">
              Alcohol is outside GST and pays your state&apos;s VAT instead. Tick the
              categories that are drinks with alcohol.
            </p>
            <PercentInput label="VAT on liquor" value={liquorVat} onChange={setLiquorVat} name="liquor_vat" />
            {categories.length > 0 ? (
              <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {categories.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800">
                      <input
                        type="checkbox"
                        checked={liquorIds.has(c.id)}
                        onChange={(e) => toggleLiquor(c.id, e.target.checked)}
                        className="h-4 w-4 rounded border-neutral-300 text-brand-600"
                      />
                      <span className="min-w-0 truncate">{c.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-neutral-500">Add categories to your menu first.</p>
            )}
          </fieldset>

          {/* Packaging */}
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Packaging charge for takeaway</span>
            <span className="flex max-w-[10rem] items-center rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900">
              <span className="pl-3 text-sm text-neutral-500">₹</span>
              <input
                name="packaging"
                value={packaging}
                onChange={(e) => setPackaging(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="w-full rounded-lg bg-transparent px-2 py-2 text-sm outline-none"
              />
            </span>
            <span className="mt-1 block text-xs text-neutral-500">
              Added once to each takeaway order, and taxed like food. Leave empty for none.
            </span>
          </label>

          {/* Round off */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Round off to the nearest rupee</p>
              <p className="text-xs text-neutral-500">The difference is shown on the bill.</p>
            </div>
            <Switch checked={roundOff} onChange={setRoundOff} label="Round off" />
          </div>

          <p className="flex gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            There is no service charge setting: in India it can&apos;t be added to a bill
            automatically. Guests may still tip.
          </p>

          {/* Preview */}
          <div aria-live="polite">
            <p className="mb-2 text-sm font-medium">Sample bill</p>
            <div className="max-w-sm rounded-lg border border-dashed border-neutral-300 p-3 text-sm dark:border-neutral-700">
              <Row label="Food" value={price(bill.foodCents)} />
              {bill.liquorCents > 0 ? <Row label="Drinks (liquor)" value={price(bill.liquorCents)} /> : null}
              {bill.taxes.map((t) => (
                <Row
                  key={t.label}
                  label={bill.taxIncluded ? `${t.label} (included)` : t.label}
                  value={price(t.cents)}
                  muted
                />
              ))}
              {bill.roundOffCents !== 0 ? (
                <Row label="Round off" value={`${bill.roundOffCents > 0 ? "+" : "−"}${price(Math.abs(bill.roundOffCents))}`} muted />
              ) : null}
              <div className="mt-1.5 border-t border-neutral-200 pt-1.5 dark:border-neutral-700">
                <Row label="Total" value={price(bill.totalCents)} strong />
              </div>
              {bill.notice ? <p className="mt-2 text-[11px] text-neutral-500">{bill.notice}</p> : null}
              {takeaway.packagingCents > 0 ? (
                <p className="mt-2 text-[11px] text-neutral-500">
                  The same food as takeaway: {price(takeaway.totalCents)}, with{" "}
                  {price(takeaway.packagingCents)} packaging.
                </p>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              Saved now, used on bills soon: the billing counter and the guest&apos;s
              bill will show these lines in the next update.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-neutral-100 px-5 py-3 dark:border-neutral-800">
          {state?.ok ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          ) : null}
          {state && !state.ok ? (
            <span role="alert" className="text-xs text-red-600">{state.error}</span>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </section>
    </form>
  );
}

function PercentInput({
  label,
  value,
  onChange,
  name,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  name?: string;
  className?: string;
}) {
  return (
    <span className={cn("flex max-w-[8rem] items-center rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900", className)}>
      <input
        name={name}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="0"
        className="w-full rounded-lg bg-transparent px-3 py-2 text-sm outline-none"
      />
      <span className="pr-3 text-sm text-neutral-500">%</span>
    </span>
  );
}

function Row({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className={cn("flex justify-between gap-3 py-0.5", muted && "text-neutral-500", strong && "font-bold")}>
      <span>{label}</span>
      <span translate="no" className="tabular-nums">{value}</span>
    </div>
  );
}
