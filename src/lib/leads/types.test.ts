import { describe, it, expect } from "vitest";

import {
  bucketFor,
  filterCities,
  formatPopulation,
  isPopulationBucket,
  searchRadiusMetres,
  type LeadCity,
} from "@/lib/leads/types";

const city = (over: Partial<LeadCity>): LeadCity => ({
  id: "Q0",
  name: "Town",
  state: "Maharashtra",
  district: "Nashik",
  population: 50_000,
  lat: 20,
  lon: 73,
  is_metro: false,
  ...over,
});

describe("bucketFor", () => {
  it("puts the seed's metro flag ahead of the population figure", () => {
    expect(bucketFor(city({ is_metro: true, population: 1 }))).toBe("metro");
  });

  it("cuts at 1, 3 and 5 lakh, lower bound inclusive", () => {
    expect(bucketFor(city({ population: 99_999 }))).toBe("under_1l");
    expect(bucketFor(city({ population: 100_000 }))).toBe("1l_3l");
    expect(bucketFor(city({ population: 299_999 }))).toBe("1l_3l");
    expect(bucketFor(city({ population: 300_000 }))).toBe("3l_5l");
    expect(bucketFor(city({ population: 500_000 }))).toBe("over_5l");
  });

  it("keeps a city Wikidata has no figure for, in its own bucket", () => {
    expect(bucketFor(city({ population: null }))).toBe("unknown");
  });
});

describe("filterCities", () => {
  const all = [
    city({ id: "a", state: "Maharashtra", district: "Nashik", population: 50_000 }),
    city({ id: "b", state: "Maharashtra", district: "Pune", population: 6_000_000 }),
    city({ id: "c", state: "Maharashtra", district: null, population: 20_000 }),
    city({ id: "d", state: "Gujarat", district: "Surat", population: 5_900_000 }),
  ];
  const ids = (cs: LeadCity[]) => cs.map((c) => c.id);

  it("narrows by state, then district, then bucket", () => {
    expect(ids(filterCities(all, {}))).toEqual(["a", "b", "c", "d"]);
    expect(ids(filterCities(all, { state: "Maharashtra" }))).toEqual(["a", "b", "c"]);
    expect(ids(filterCities(all, { state: "Maharashtra", district: "Pune" }))).toEqual(["b"]);
    expect(ids(filterCities(all, { bucket: "over_5l" }))).toEqual(["b", "d"]);
  });

  it("drops a city with no district once a district is chosen", () => {
    expect(ids(filterCities(all, { state: "Maharashtra", district: "Nashik" }))).toEqual(["a"]);
  });
});

describe("formatPopulation", () => {
  it("speaks in lakh and crore", () => {
    expect(formatPopulation(null)).toBe("—");
    expect(formatPopulation(45_000)).toBe("45,000");
    expect(formatPopulation(1_486_000)).toBe("14.9 lakh");
    expect(formatPopulation(15_414_288)).toBe("1.5 crore");
  });
});

describe("searchRadiusMetres", () => {
  it("widens with the size of the place", () => {
    expect(searchRadiusMetres(city({ is_metro: true }))).toBe(15_000);
    expect(searchRadiusMetres(city({ population: 700_000 }))).toBe(10_000);
    expect(searchRadiusMetres(city({ population: 150_000 }))).toBe(7_000);
    expect(searchRadiusMetres(city({ population: 30_000 }))).toBe(5_000);
    expect(searchRadiusMetres(city({ population: null }))).toBe(5_000);
  });
});

describe("isPopulationBucket", () => {
  it("accepts only the keys in the list", () => {
    expect(isPopulationBucket("metro")).toBe(true);
    expect(isPopulationBucket("huge")).toBe(false);
  });
});
