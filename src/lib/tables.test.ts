import { describe, it, expect } from "vitest";

import { expandTableLabels, sortByLabel } from "@/lib/tables";

describe("expandTableLabels()", () => {
  it("expands a plain numeric range", () => {
    expect(expandTableLabels("1-4")).toEqual(["1", "2", "3", "4"]);
    expect(expandTableLabels("1 to 3")).toEqual(["1", "2", "3"]);
  });

  it("expands a prefixed range and keeps the prefix", () => {
    expect(expandTableLabels("Patio 1-3")).toEqual(["Patio 1", "Patio 2", "Patio 3"]);
    expect(expandTableLabels("T1-T3")).toEqual(["T1", "T2", "T3"]);
  });

  it("splits comma and newline lists, trimming and de-duplicating", () => {
    expect(expandTableLabels("Bar,  Window\nBar , Garden")).toEqual([
      "Bar",
      "Window",
      "Garden",
    ]);
  });

  it("mixes ranges and names", () => {
    expect(expandTableLabels("1-2, Rooftop")).toEqual(["1", "2", "Rooftop"]);
  });

  it("treats a backwards or mismatched range as a literal label", () => {
    expect(expandTableLabels("5-3")).toEqual(["5-3"]);
    expect(expandTableLabels("A1-B3")).toEqual(["A1-B3"]);
  });

  it("caps the total", () => {
    expect(expandTableLabels("1-1000", 10)).toHaveLength(10);
  });

  it("ignores empty input", () => {
    expect(expandTableLabels("  \n , ")).toEqual([]);
  });
});

describe("sortByLabel()", () => {
  it("orders numerically inside labels", () => {
    const sorted = sortByLabel([
      { label: "Table 10" },
      { label: "Table 2" },
      { label: "Bar" },
      { label: "table 1" },
    ]);
    expect(sorted.map((t) => t.label)).toEqual(["Bar", "table 1", "Table 2", "Table 10"]);
  });
});
