// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import LandingPage from "@/app/page";
import { SUPPORTED_LOCALES } from "@/lib/constants";
import { PLAN_INCLUDES, PLAN_PRICE_LABELS } from "@/lib/plans";

afterEach(cleanup);

// The public page shows only what is true of the product: no demo restaurant,
// no mock menu, no invented figures, and the prices that are charged.
describe("landing page", () => {
  it("links nowhere near a demo restaurant", () => {
    render(<LandingPage />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs.filter((h) => h?.startsWith("/m/"))).toEqual([]);
    expect(screen.queryByText(/demo/i)).toBeNull();
  });

  it("shows no invented restaurant, dish, or dollar price", () => {
    const { container } = render(<LandingPage />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("Copper Fork");
    expect(text).not.toContain("$");
    expect(text).not.toMatch(/\d+\s*[–-]\s*\d+\s*%/);
  });

  it("quotes the two plans that exist, at the prices that are charged", () => {
    render(<LandingPage />);
    const pricing = document.getElementById("pricing") as HTMLElement;
    const plans = within(pricing).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(plans).toEqual(["Starter", "Pro"]);
    expect(pricing.textContent).toContain(`${PLAN_PRICE_LABELS.starter}/year`);
    expect(pricing.textContent).toContain(`${PLAN_PRICE_LABELS.pro}/year`);
  });

  it("lists exactly what each plan includes", () => {
    render(<LandingPage />);
    const pricing = document.getElementById("pricing") as HTMLElement;
    for (const feature of [...PLAN_INCLUDES.starter, ...PLAN_INCLUDES.pro]) {
      expect(within(pricing).getByText(feature)).toBeTruthy();
    }
    expect(within(pricing).getAllByRole("listitem")).toHaveLength(
      PLAN_INCLUDES.starter.length + PLAN_INCLUDES.pro.length,
    );
  });

  it("states the real number of languages and the real trial length", () => {
    const { container } = render(<LandingPage />);
    const text = container.textContent ?? "";
    expect(text).toContain(`${SUPPORTED_LOCALES.length}Languages`);
    expect(text).toContain("15 daysFree trial");
    expect(text).not.toMatch(/\d+\+/);
  });

  it("sends every call to action to sign-up or to the pricing section", () => {
    render(<LandingPage />);
    const cta = screen
      .getAllByRole("link", { name: /free trial|see pricing|get started/i })
      .map((a) => a.getAttribute("href"));
    expect(cta.length).toBeGreaterThanOrEqual(5);
    expect(new Set(cta)).toEqual(new Set(["/signup", "#pricing"]));
  });
});
