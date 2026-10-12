// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { RankedBars, SplitBar, StatTiles } from "@/components/dashboard/insights/Figures";
import type { StatTile } from "@/lib/insights";

afterEach(cleanup);

const tile = (o: Partial<StatTile>): StatTile => ({
  label: "Sales today",
  value: "₹4,500.00",
  delta: null,
  hint: "₹3,000.00 last Monday",
  ...o,
});

const text = (label: string) => screen.getByText(label).parentElement?.textContent ?? "";

describe("StatTiles", () => {
  it("shows the value and what it is compared with", () => {
    render(<StatTiles tiles={[tile({})]} />);
    expect(text("Sales today")).toBe("Sales today₹4,500.00₹3,000.00 last Monday");
  });

  it("says which way a number moved in words, not only in colour", () => {
    render(
      <StatTiles
        tiles={[
          tile({ label: "Up", delta: { pct: 50, direction: "up" } }),
          tile({ label: "Down", delta: { pct: 30, direction: "down" } }),
          tile({ label: "Flat", delta: { pct: 0, direction: "flat" } }),
        ]}
      />,
    );
    expect(text("Up")).toContain("50% up");
    expect(text("Down")).toContain("30% down");
    expect(text("Flat")).toContain("No change");
  });
});

describe("RankedBars", () => {
  const rows = [
    { name: "Paneer Tikka", value: 40, pct: 100, valueLabel: "40 sold", detail: "₹12,800.00" },
    { name: "Dal Makhani", value: 1, pct: 0, valueLabel: "1 sold", detail: "" },
  ];

  it("lists each row with its value written at the end", () => {
    render(<RankedBars rows={rows} empty="Nothing sold." />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Paneer Tikka40 sold · ₹12,800.00",
      "Dal Makhani1 sold",
    ]);
  });

  it("sizes each bar against the longest and never draws one too thin to see", () => {
    render(<RankedBars rows={rows} empty="Nothing sold." />);
    const bars = screen.getAllByRole("listitem").map((li) => (li.lastElementChild as HTMLElement).style.width);
    expect(bars).toEqual(["100%", "1.5%"]);
  });

  it("says so when there is nothing to rank", () => {
    render(<RankedBars rows={[]} empty="Nothing sold." />);
    expect(screen.getByText("Nothing sold.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("SplitBar", () => {
  const parts = [
    { label: "Guests, on their phones", value: 45, pct: 69, valueLabel: "45 orders" },
    { label: "Waiters", value: 20, pct: 31, valueLabel: "20 orders" },
  ];

  it("draws the two shares in proportion and names them", () => {
    render(<SplitBar parts={parts} label="Orders by who placed them" />);
    const bar = screen.getByRole("img");
    expect(bar.getAttribute("aria-label")).toBe(
      "Orders by who placed them: Guests, on their phones 69%, Waiters 31%",
    );
    expect(Array.from(bar.children).map((c) => (c as HTMLElement).style.flexGrow)).toEqual([
      "45",
      "20",
    ]);
  });

  it("writes each share out beside its swatch", () => {
    render(<SplitBar parts={parts} label="Orders by who placed them" />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Guests, on their phones69%45 orders",
      "Waiters31%20 orders",
    ]);
  });

  it("draws nothing for a share of zero but still lists it", () => {
    render(
      <SplitBar
        parts={[
          { label: "Dine in", value: 12, pct: 100, valueLabel: "12 orders" },
          { label: "Parcel", value: 0, pct: 0, valueLabel: "0 orders" },
        ]}
        label="Orders by dine in or parcel"
      />,
    );
    expect(screen.getByRole("img").children).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("says so when there were no orders at all", () => {
    render(
      <SplitBar
        parts={parts.map((p) => ({ ...p, value: 0, pct: 0 }))}
        label="Orders by who placed them"
      />,
    );
    expect(screen.getByText("No orders in the last 30 days.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
