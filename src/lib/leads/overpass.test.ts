import { describe, it, expect, vi } from "vitest";

import {
  buildOverpassQuery,
  fetchOsmRestaurants,
  OverpassError,
  parseOverpassElements,
} from "@/lib/leads/overpass";

describe("buildOverpassQuery", () => {
  it("asks for food places around a point, with centres for ways", () => {
    const q = buildOverpassQuery(19.9975, 73.7898, 5000.4);
    expect(q).toContain("(around:5000,19.9975,73.7898)");
    expect(q).toContain('"amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream)$"');
    expect(q).toContain("out tags center;");
  });
});

describe("parseOverpassElements", () => {
  it("keeps named places and reads the contact tags OSM actually uses", () => {
    const rows = parseOverpassElements([
      {
        type: "node",
        id: 1,
        lat: 20.0,
        lon: 73.8,
        tags: {
          name: "Cafe Nashik",
          "contact:phone": "+91 91111 11111",
          "contact:website": "https://cafenashik.in",
          cuisine: "indian;pizza",
          "addr:street": "College Road",
          "addr:city": "Nashik",
        },
      },
      // A building outline: the position comes from `center`.
      {
        type: "way",
        id: 2,
        center: { lat: 20.1, lon: 73.9 },
        tags: { name: "Sai Dhaba", phone: "02532000000", "addr:full": "Mumbai Naka, Nashik" },
      },
      // No name: useless on a call sheet.
      { type: "node", id: 3, lat: 20, lon: 73, tags: { amenity: "restaurant" } },
      // Only an English name.
      { type: "node", id: 4, lat: 20, lon: 73, tags: { "name:en": "Hotel Gokul" } },
    ]);

    expect(rows).toEqual([
      {
        osm_ref: "node/1",
        name: "Cafe Nashik",
        phone: "+91 91111 11111",
        website: "https://cafenashik.in",
        address: "College Road, Nashik",
        cuisine: "indian, pizza",
        lat: 20.0,
        lon: 73.8,
      },
      {
        osm_ref: "way/2",
        name: "Sai Dhaba",
        phone: "02532000000",
        website: null,
        address: "Mumbai Naka, Nashik",
        cuisine: null,
        lat: 20.1,
        lon: 73.9,
      },
      {
        osm_ref: "node/4",
        name: "Hotel Gokul",
        phone: null,
        website: null,
        address: null,
        cuisine: null,
        lat: 20,
        lon: 73,
      },
    ]);
  });

  it("returns nothing for a malformed body", () => {
    expect(parseOverpassElements(undefined)).toEqual([]);
    expect(parseOverpassElements({ not: "an array" })).toEqual([]);
    expect(parseOverpassElements([{ tags: { name: "No type or id" } }])).toEqual([]);
  });
});

describe("fetchOsmRestaurants", () => {
  const city = { lat: 20, lon: 73, population: 50_000, is_metro: false };

  it("posts the query and parses the elements", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      expect(body.get("data")).toContain("(around:5000,20,73)");
      expect((init?.headers as Record<string, string>)["User-Agent"]).toContain("fast_menu");
      return new Response(
        JSON.stringify({
          elements: [{ type: "node", id: 9, lat: 20, lon: 73, tags: { name: "X" } }],
        }),
        { status: 200 },
      );
    });
    const rows = await fetchOsmRestaurants(city, fetchImpl as unknown as typeof fetch);
    expect(rows.map((r) => r.osm_ref)).toEqual(["node/9"]);
  });

  it("explains a busy server in words a caller can act on", async () => {
    const busy = vi.fn(async () => new Response("", { status: 429 }));
    await expect(
      fetchOsmRestaurants(city, busy as unknown as typeof fetch),
    ).rejects.toThrow(OverpassError);
    await expect(
      fetchOsmRestaurants(city, busy as unknown as typeof fetch),
    ).rejects.toThrow(/busy/);
  });
});
