// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ColumnChart } from "@/components/dashboard/insights/ColumnChart";
import type { ChartData } from "@/lib/insights";

afterEach(cleanup);

const point = (key: string, value: number, peak = false) => ({
  key,
  axisLabel: key === "tue" ? "" : key.toUpperCase(),
  value,
  title: `Day ${key}`,
  valueLabel: `${value} orders`,
  shortValue: String(value),
  detail: value > 0 ? `₹${value * 100} in sales` : "",
  peak,
});

const data: ChartData = {
  points: [point("mon", 10), point("tue", 0), point("wed", 40, true), point("thu", 20)],
  ticks: [
    { value: 0, label: "0" },
    { value: 20, label: "20" },
    { value: 40, label: "40" },
  ],
};

const setup = (chart = data) =>
  render(<ColumnChart data={chart} label="Orders by day" columns={["Day", "Orders", "Sales"]} />);

const columns = () => within(screen.getByRole("list", { name: "Orders by day" })).getAllByRole("listitem");
const bar = (el: HTMLElement) => el.firstElementChild as HTMLElement;

describe("ColumnChart", () => {
  it("draws one column per point, scaled against the top tick", () => {
    setup();
    expect(columns()).toHaveLength(4);
    expect(columns().map((c) => bar(c).style.height)).toEqual(["25%", "0%", "100%", "50%"]);
  });

  it("gives a small value a visible mark and a zero none", () => {
    setup();
    expect(bar(columns()[0]).style.minHeight).toBe("2px");
    expect(bar(columns()[1]).style.minHeight).toBe("0px");
  });

  it("names every column for a screen reader, value included", () => {
    setup();
    expect(columns().map((c) => c.getAttribute("aria-label"))).toEqual([
      "Day mon, 10 orders, ₹1000 in sales",
      "Day tue, 0 orders",
      "Day wed, 40 orders, ₹4000 in sales",
      "Day thu, 20 orders, ₹2000 in sales",
    ]);
  });

  it("labels only the tallest column", () => {
    setup();
    expect(within(columns()[2]).getByText("40")).toBeTruthy();
    expect(within(columns()[0]).queryByText("10")).toBeNull();
  });

  it("prints the axis labels it was given and skips the empty ones", () => {
    const { container } = setup();
    const axis = container.querySelector("figure > div:last-child > div:last-child > div:last-child");
    expect(Array.from(axis?.children ?? []).map((c) => c.textContent)).toEqual([
      "MON",
      "",
      "WED",
      "THU",
    ]);
  });

  it("shows the value, title and detail of the column under the pointer", () => {
    setup();
    expect(screen.queryByText("₹2000 in sales")).toBeNull();

    fireEvent.pointerEnter(columns()[3], { pointerType: "mouse" });
    expect(screen.getByText("20 orders")).toBeTruthy();
    expect(screen.getByText("Day thu")).toBeTruthy();
    expect(screen.getByText("₹2000 in sales")).toBeTruthy();

    fireEvent.pointerLeave(columns()[3], { pointerType: "mouse" });
    expect(screen.queryByText("₹2000 in sales")).toBeNull();
  });

  it("shows the same on keyboard focus and on a tap", async () => {
    const user = userEvent.setup();
    setup();

    await user.tab(); // the table toggle
    await user.tab(); // the first column
    expect(screen.getByText("₹1000 in sales")).toBeTruthy();

    await user.click(columns()[2]);
    expect(screen.getByText("₹4000 in sales")).toBeTruthy();
    expect(screen.queryByText("₹1000 in sales")).toBeNull();
  });

  it("offers the same numbers as a table", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Show table" }));
    const table = screen.getByRole("table", { name: "Orders by day" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Day",
      "Orders",
      "Sales",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      "Day mon10 orders₹1000 in sales",
      "Day tue0 orders",
      "Day wed40 orders₹4000 in sales",
      "Day thu20 orders₹2000 in sales",
    ]);

    await user.click(screen.getByRole("button", { name: "Show chart" }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(columns()).toHaveLength(4);
  });

  it("drops the third column from the table when no point has a second fact", async () => {
    const user = userEvent.setup();
    setup({ ...data, points: data.points.map((p) => ({ ...p, detail: "" })) });
    await user.click(screen.getByRole("button", { name: "Show table" }));
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
  });

  it("still draws an axis when every value is zero", () => {
    setup({
      points: [point("mon", 0), point("tue", 0)],
      ticks: [
        { value: 0, label: "0" },
        { value: 1, label: "1" },
      ],
    });
    expect(columns().map((c) => bar(c).style.height)).toEqual(["0%", "0%"]);
  });
});
