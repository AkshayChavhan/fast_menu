import { describe, it, expect } from "vitest";

import { claudePromptFor, importTemplate, parseLeadImport } from "@/lib/leads/import";

describe("parseLeadImport", () => {
  it("reads the documented shape and turns NA into unknown, never into no", () => {
    const { city, state, rows, skipped } = parseLeadImport(
      JSON.stringify({
        city: "Nashik",
        state: "Maharashtra",
        restaurants: [
          {
            name: " Hotel Sai Palace ",
            type: "Restaurant",
            phone: "+91 98765 43210",
            whatsapp: "NA",
            isWebsiteAvailable: false,
            website: "N/A",
            isDigitalMenuAvailable: "NA",
            isHardMenuAvailable: "yes",
            onZomato: "true",
            onSwiggy: null,
            googleRating: "4.3 stars",
            googleReviewCount: "1,240",
            priceLevel: "₹₹",
            lat: "19.9975",
            lon: 73.7898,
            verified: false,
            notes: "—",
            ownerAge: 52,
          },
        ],
      }),
    );
    expect(city).toBe("Nashik");
    expect(state).toBe("Maharashtra");
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.name).toBe("Hotel Sai Palace");
    expect(r.kind).toBe("restaurant");
    expect(r.phone).toBe("+91 98765 43210");
    expect(r.whatsapp).toBeNull();
    expect(r.website).toBeNull();
    expect(r.website_known).toBe(false);
    expect(r.digital_menu).toBeNull();
    expect(r.hard_menu).toBe(true);
    expect(r.on_zomato).toBe(true);
    expect(r.on_swiggy).toBeNull();
    expect(r.google_rating).toBe(4.3);
    expect(r.google_review_count).toBe(1240);
    expect(r.price_level).toBe(2);
    expect(r.lat).toBe(19.9975);
    expect(r.lon).toBe(73.7898);
    expect(r.notes).toBeNull();
    // Unlisted fields ride along; NA ones do not.
    expect(r.extra).toEqual({ ownerAge: 52 });
  });

  it("treats a URL as a website whatever the flag says", () => {
    const { rows } = parseLeadImport(
      JSON.stringify([{ name: "X", website: "x.in", isWebsiteAvailable: false }]),
    );
    expect(rows[0].website).toBe("x.in");
    expect(rows[0].website_known).toBe(true);
  });

  it("accepts snake_case and a bare array", () => {
    const { rows } = parseLeadImport(
      JSON.stringify([
        { name: "Y", google_rating: 4.1, google_review_count: "2.3k", digital_menu: "no", lng: 74.1 },
      ]),
    );
    expect(rows[0].google_rating).toBe(4.1);
    expect(rows[0].google_review_count).toBe(2300);
    expect(rows[0].digital_menu).toBe(false);
    expect(rows[0].lon).toBe(74.1);
  });

  it("drops a rating outside 0–5 and a coordinate outside India", () => {
    const { rows } = parseLeadImport(
      JSON.stringify([{ name: "Z", rating: 9, lat: 51.5, lon: -0.1 }]),
    );
    expect(rows[0].google_rating).toBeNull();
    expect(rows[0].lat).toBeNull();
    expect(rows[0].lon).toBeNull();
  });

  it("skips a row with no name and says which", () => {
    const { rows, skipped } = parseLeadImport(
      JSON.stringify([{ name: "A" }, { name: "NA", phone: "1" }, { phone: "2" }, { name: "B" }]),
    );
    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
    expect(skipped).toEqual([
      { index: 1, reason: "no name" },
      { index: 2, reason: "no name" },
    ]);
  });

  it("maps loose type words onto the known kinds", () => {
    const kinds = ["Udupi hotel", "Tea stall", "Dhaba", "cloud kitchen", "Pub", "Cake shop", "Mithai", "Gym"];
    const { rows } = parseLeadImport(JSON.stringify(kinds.map((t) => ({ name: t, type: t }))));
    expect(rows.map((r) => r.kind)).toEqual([
      "restaurant",
      "cafe",
      "dhaba",
      "cloud_kitchen",
      "bar",
      "bakery",
      "sweet_shop",
      "other",
    ]);
  });

  it("explains bad input in words", () => {
    expect(() => parseLeadImport("{not json")).toThrow(/not valid JSON/);
    expect(() => parseLeadImport("{}")).toThrow(/shape|restaurants/i);
    expect(() => parseLeadImport('{"restaurants": []}')).toThrow(/no restaurants/);
  });
});

describe("importTemplate and claudePromptFor", () => {
  it("round-trip: the template parses to one row with unknowns", () => {
    const { rows, city } = parseLeadImport(importTemplate("Nashik", "Maharashtra"));
    expect(city).toBe("Nashik");
    expect(rows).toHaveLength(1);
    expect(rows[0].digital_menu).toBeNull();
    expect(rows[0].google_rating).toBe(4.3);
  });

  it("the prompt names the city, forbids guessing, and embeds the template", () => {
    const p = claudePromptFor("Nashik", "Maharashtra", 25);
    expect(p).toContain("25 real restaurants");
    expect(p).toContain("Nashik, Maharashtra");
    expect(p).toContain('write "NA"');
    expect(p).toContain("sourceUrl");
    expect(p).toContain('"restaurants": [');
  });
});
