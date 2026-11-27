// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Restaurant } from "@/types/db";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/dashboard/settings/actions", () => ({ updateBillingSettings: vi.fn() }));

import { BillingSettingsCard } from "@/components/dashboard/settings/BillingSettingsCard";

afterEach(cleanup);

const restaurant = {
  id: "11111111-1111-4111-8111-111111111111",
  currency: "INR",
  default_locale: "en",
  gstin: "27AAPFU0939F1ZV",
  tax_mode: "none",
  gst_rate_bp: 500,
  prices_include_tax: false,
  liquor_vat_bp: 1000,
  packaging_cents: 0,
  round_off: true,
} as unknown as Restaurant;

const categories = [
  { id: "a0000000-0000-4000-8000-000000000001", name: "Soups", tax_class: "food" as const },
  { id: "a0000000-0000-4000-8000-000000000002", name: "Cocktails", tax_class: "liquor" as const },
];

describe("BillingSettingsCard", () => {
  it("starts with no GST lines for a restaurant not registered", () => {
    render(<BillingSettingsCard restaurant={restaurant} categories={categories} />);
    expect(screen.queryByText(/^CGST /)).toBeNull();
    // The liquor category is ticked, so the sample has drinks and their VAT.
    expect(screen.getByText("VAT on liquor 10%")).toBeTruthy();
    expect(screen.queryByPlaceholderText("27AAPFU0939F1ZV")).toBeNull();
  });

  it("shows CGST and SGST and asks for the GSTIN once GST is chosen", () => {
    render(<BillingSettingsCard restaurant={restaurant} categories={categories} />);
    fireEvent.click(screen.getByText("Regular GST"));
    expect(screen.getByText("CGST 2.5%")).toBeTruthy();
    expect(screen.getByText("SGST 2.5%")).toBeTruthy();
    expect((screen.getByPlaceholderText("27AAPFU0939F1ZV") as HTMLInputElement).value).toBe(
      "27AAPFU0939F1ZV",
    );
    fireEvent.click(screen.getByText("18%"));
    expect(screen.getByText("CGST 9%")).toBeTruthy();
  });

  it("drops the drinks from the sample when no category is liquor", () => {
    render(<BillingSettingsCard restaurant={restaurant} categories={categories} />);
    fireEvent.click(screen.getByLabelText("Cocktails"));
    expect(screen.queryByText(/VAT on liquor/)).toBeNull();
    expect(screen.queryByText("Drinks (liquor)")).toBeNull();
  });

  it("prints the composition notice and no GST", () => {
    render(<BillingSettingsCard restaurant={restaurant} categories={categories} />);
    fireEvent.click(screen.getByText("Composition scheme"));
    expect(screen.queryByText(/^CGST /)).toBeNull();
    expect(screen.getByText(/not eligible to collect tax/)).toBeTruthy();
  });

  it("sends the ticked liquor categories with the form", () => {
    const { container } = render(<BillingSettingsCard restaurant={restaurant} categories={categories} />);
    const sent = [...container.querySelectorAll('input[name="liquor_category"]')].map(
      (i) => (i as HTMLInputElement).value,
    );
    expect(sent).toEqual([categories[1].id]);
  });
});
