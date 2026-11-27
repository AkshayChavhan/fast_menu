import { describe, it, expect } from "vitest";
import {
  DEFAULT_TAX_SETTINGS,
  COMPOSITION_NOTICE,
  GSTIN_PATTERN,
  computeBill,
  normalizeGstin,
  percentLabel,
  type TaxSettings,
} from "@/lib/bill-tax";

const s = (over: Partial<TaxSettings>): TaxSettings => ({ ...DEFAULT_TAX_SETTINGS, ...over });
const food = (cents: number) => ({ cents, taxClass: "food" as const });
const liquor = (cents: number) => ({ cents, taxClass: "liquor" as const });

describe("computeBill", () => {
  it("adds nothing for a restaurant not registered for GST", () => {
    const b = computeBill([food(553400)], s({ round_off: false }));
    expect(b.taxes).toEqual([]);
    expect(b.totalCents).toBe(553400);
    expect(b.notice).toBeNull();
  });

  it("adds 5% GST as CGST 2.5% + SGST 2.5% on top", () => {
    const b = computeBill([food(553400)], s({ tax_mode: "gst", round_off: false }));
    expect(b.taxes).toEqual([
      { label: "CGST 2.5%", cents: 13835 },
      { label: "SGST 2.5%", cents: 13835 },
    ]);
    expect(b.totalCents).toBe(581070);
  });

  it("rounds to the nearest rupee and shows the difference", () => {
    const b = computeBill([food(553400)], s({ tax_mode: "gst" }));
    expect(b.roundOffCents).toBe(30);
    expect(b.totalCents).toBe(581100);
    const down = computeBill([food(10020)], s({ round_off: true }));
    expect(down.roundOffCents).toBe(-20);
  });

  it("18% splits into 9% + 9%", () => {
    const b = computeBill([food(100000)], s({ tax_mode: "gst", gst_rate_bp: 1800 }));
    expect(b.taxes.map((t) => t.label)).toEqual(["CGST 9%", "SGST 9%"]);
    expect(b.taxes.reduce((n, t) => n + t.cents, 0)).toBe(18000);
  });

  it("an odd paisa of GST goes to SGST, so the halves always add up", () => {
    const b = computeBill([food(1010)], s({ tax_mode: "gst", round_off: false }));
    const [c, g] = b.taxes;
    expect(c.cents + g.cents).toBe(51);
    expect(g.cents - c.cents).toBe(1);
  });

  it("works the tax out of prices that already include it, without changing the total", () => {
    const b = computeBill([food(105000)], s({ tax_mode: "gst", prices_include_tax: true }));
    expect(b.taxIncluded).toBe(true);
    expect(b.taxes.reduce((n, t) => n + t.cents, 0)).toBe(5000);
    expect(b.totalCents).toBe(105000);
  });

  it("never collects GST under the composition scheme, and says so", () => {
    const b = computeBill([food(100000)], s({ tax_mode: "composition", gst_rate_bp: 500 }));
    expect(b.taxes).toEqual([]);
    expect(b.totalCents).toBe(100000);
    expect(b.notice).toBe(COMPOSITION_NOTICE);
  });

  it("charges VAT on liquor only, whatever the GST mode", () => {
    const b = computeBill(
      [food(100000), liquor(50000)],
      s({ tax_mode: "gst", liquor_vat_bp: 1000 }),
    );
    expect(b.foodCents).toBe(100000);
    expect(b.liquorCents).toBe(50000);
    expect(b.taxes).toEqual([
      { label: "CGST 2.5%", cents: 2500 },
      { label: "SGST 2.5%", cents: 2500 },
      { label: "VAT on liquor 10%", cents: 5000 },
    ]);
    expect(b.totalCents).toBe(160000);
    const composition = computeBill([liquor(50000)], s({ tax_mode: "composition", liquor_vat_bp: 1000 }));
    expect(composition.taxes).toEqual([{ label: "VAT on liquor 10%", cents: 5000 }]);
  });

  it("adds the packaging charge to takeaway only, and taxes it like food", () => {
    const settings = s({ tax_mode: "gst", packaging_cents: 2000, round_off: false });
    expect(computeBill([food(10000)], settings).packagingCents).toBe(0);
    const t = computeBill([food(10000)], settings, { takeaway: true });
    expect(t.packagingCents).toBe(2000);
    expect(t.totalCents).toBe(12000 + 600);
    expect(computeBill([], settings, { takeaway: true }).totalCents).toBe(0);
  });
});

describe("helpers", () => {
  it("labels basis points as a percentage", () => {
    expect(percentLabel(250)).toBe("2.5%");
    expect(percentLabel(900)).toBe("9%");
    expect(percentLabel(1250)).toBe("12.5%");
  });

  it("normalizes and checks a GSTIN", () => {
    const g = normalizeGstin(" 27aapfu0939f1zv ");
    expect(g).toBe("27AAPFU0939F1ZV");
    expect(GSTIN_PATTERN.test(g)).toBe(true);
    expect(GSTIN_PATTERN.test("27AAPFU0939F1Z")).toBe(false);
  });
});
