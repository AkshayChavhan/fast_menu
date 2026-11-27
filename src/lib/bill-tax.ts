// Taxes and charges on a restaurant bill: the one place the arithmetic lives.
//
// The owner's settings are on the restaurant row (migrations/*_billing_tax.sql)
// and edited under Settings -> Bill & taxes. The settings card previews a
// sample bill with this; settled bills will snapshot its result.
//
// Everything is in minor units (paise) and integer basis points (500 = 5%),
// so no floating-point money ever reaches a bill.

export type TaxMode = "none" | "gst" | "composition";
export type TaxClass = "food" | "liquor";

export const TAX_MODES: readonly TaxMode[] = ["none", "gst", "composition"];
export const TAX_CLASSES: readonly TaxClass[] = ["food", "liquor"];

export interface TaxSettings {
  tax_mode: TaxMode;
  gst_rate_bp: number;
  prices_include_tax: boolean;
  liquor_vat_bp: number;
  packaging_cents: number;
  round_off: boolean;
}

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  tax_mode: "none",
  gst_rate_bp: 500,
  prices_include_tax: false,
  liquor_vat_bp: 0,
  packaging_cents: 0,
  round_off: true,
};

// The two rates an owner is most likely to need. See the migration header
// for when each applies; the owner confirms theirs with their CA.
export const GST_PRESETS = [
  { bp: 500, label: "5%", hint: "Most restaurants, cafés and cloud kitchens" },
  { bp: 1800, label: "18%", hint: "Inside a hotel with rooms above ₹7,500 a night" },
] as const;

// Required on a bill of supply under the composition scheme.
export const COMPOSITION_NOTICE =
  "Composition taxable person, not eligible to collect tax on supplies";

// The standard 15-character GSTIN: state code, PAN, entity, 'Z', checksum.
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function normalizeGstin(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

export interface BillLine {
  /** Line total in paise: unit price x quantity, as the menu priced it. */
  cents: number;
  taxClass: TaxClass;
}

export interface TaxLine {
  label: string;
  cents: number;
}

export interface BillBreakdown {
  /** Dish totals as priced on the menu. */
  foodCents: number;
  liquorCents: number;
  packagingCents: number;
  /** Tax lines in display order: CGST, SGST, VAT on liquor. */
  taxes: TaxLine[];
  /** True when the taxes are already inside the prices ("incl."). */
  taxIncluded: boolean;
  /** Positive or negative paise added to reach a whole rupee. */
  roundOffCents: number;
  totalCents: number;
  /** A line the bill must carry, e.g. the composition notice. */
  notice: string | null;
}

// "2.5%" from 250, "9%" from 900.
export function percentLabel(bp: number): string {
  return `${Number((bp / 100).toFixed(2))}%`;
}

// Tax on an amount, or the tax inside an amount that already includes it.
// Rounded half up to the paisa.
function taxOn(cents: number, bp: number, included: boolean): number {
  if (bp <= 0 || cents <= 0) return 0;
  const exact = included ? (cents * bp) / (10000 + bp) : (cents * bp) / 10000;
  return Math.round(exact);
}

/**
 * Work out a bill. Taxes follow the restaurant's settings:
 *
 * - GST (regular): food and packaging pay GST, split evenly into CGST and
 *   SGST (an odd paisa goes to SGST so the two always add up).
 * - Composition: no GST may be collected; the bill carries the notice.
 * - Liquor pays the state VAT, whatever the GST mode.
 * - Prices that include tax: the tax is worked out of them and shown, and the
 *   total is unchanged. Otherwise it is added on top.
 */
export function computeBill(
  lines: readonly BillLine[],
  settings: TaxSettings,
  opts: { takeaway?: boolean } = {},
): BillBreakdown {
  const foodCents = lines
    .filter((l) => l.taxClass === "food")
    .reduce((n, l) => n + Math.max(0, l.cents), 0);
  const liquorCents = lines
    .filter((l) => l.taxClass === "liquor")
    .reduce((n, l) => n + Math.max(0, l.cents), 0);
  const packagingCents =
    opts.takeaway && lines.length > 0 ? Math.max(0, settings.packaging_cents) : 0;

  const included = settings.prices_include_tax;
  const taxes: TaxLine[] = [];

  if (settings.tax_mode === "gst" && settings.gst_rate_bp > 0) {
    const gst = taxOn(foodCents + packagingCents, settings.gst_rate_bp, included);
    const half = settings.gst_rate_bp / 2;
    const cgst = Math.floor(gst / 2);
    taxes.push({ label: `CGST ${percentLabel(half)}`, cents: cgst });
    taxes.push({ label: `SGST ${percentLabel(half)}`, cents: gst - cgst });
  }
  if (settings.liquor_vat_bp > 0 && liquorCents > 0) {
    taxes.push({
      label: `VAT on liquor ${percentLabel(settings.liquor_vat_bp)}`,
      cents: taxOn(liquorCents, settings.liquor_vat_bp, included),
    });
  }

  const added = included ? 0 : taxes.reduce((n, t) => n + t.cents, 0);
  const beforeRound = foodCents + liquorCents + packagingCents + added;
  const roundOffCents = settings.round_off ? Math.round(beforeRound / 100) * 100 - beforeRound : 0;

  return {
    foodCents,
    liquorCents,
    packagingCents,
    taxes,
    taxIncluded: included && taxes.length > 0,
    roundOffCents,
    totalCents: beforeRound + roundOffCents,
    notice: settings.tax_mode === "composition" ? COMPOSITION_NOTICE : null,
  };
}
