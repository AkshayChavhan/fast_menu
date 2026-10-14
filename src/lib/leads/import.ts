// The JSON a person uploads for a city: from Claude with web search on, a
// JustDial export, a field agent's spreadsheet. Lenient on purpose — people
// and models write "NA", "N/A", "yes", "4.3 stars" — and strict about one
// thing: unknown stays unknown. Nothing here turns "NA" into "no".

import { z } from "zod";

export const LEAD_KINDS = [
  "restaurant",
  "cafe",
  "dhaba",
  "cloud_kitchen",
  "bar",
  "bakery",
  "sweet_shop",
  "other",
] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

// Every spelling of "we don't know" that has shown up in a file.
const UNKNOWN = new Set(["", "na", "n/a", "n.a.", "none", "null", "unknown", "not available", "-", "—", "?"]);

function isUnknown(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return UNKNOWN.has(v.trim().toLowerCase());
  return false;
}

// "" | NA | null → null; otherwise the trimmed string.
const text = (max = 300) =>
  z.preprocess((v) => (isUnknown(v) ? null : String(v).trim()), z.string().max(max).nullable());

// true/false/yes/no/y/n/1/0 → boolean; anything unknown → null.
const flag = z.preprocess((v) => {
  if (isUnknown(v)) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["true", "yes", "y", "1", "available"].includes(s)) return true;
  if (["false", "no", "n", "0", "not available", "unavailable"].includes(s)) return false;
  return null;
}, z.boolean().nullable());

// 4.3 | "4.3" | "4.3 stars" | "4.3/5" → 4.3; outside 0–5 or unknown → null.
const rating = z.preprocess((v) => {
  if (isUnknown(v)) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.]/g, " ").trim().split(/\s+/)[0] ?? "");
  return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n * 10) / 10 : null;
}, z.number().nullable());

// 1240 | "1,240" | "1.2k reviews" → integer; unknown → null.
const count = z.preprocess((v) => {
  if (isUnknown(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  const s = String(v).trim().toLowerCase().replace(/,/g, "");
  const m = s.match(/([\d.]+)\s*(k)?/);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}, z.number().int().nullable());

const coord = (min: number, max: number) =>
  z.preprocess((v) => {
    if (isUnknown(v)) return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }, z.number().nullable());

const level = z.preprocess((v) => {
  if (isUnknown(v)) return null;
  const n = typeof v === "number" ? v : (String(v).match(/₹/g) ?? []).length || parseInt(String(v), 10);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}, z.number().int().nullable());

// A public http(s) link, or unknown. Not fetched or copied: shown as-is.
const url = z.preprocess((v) => {
  if (isUnknown(v)) return null;
  const s = String(v).trim();
  return /^https?:\/\/\S+$/i.test(s) ? s.slice(0, 1000) : null;
}, z.string().nullable());

const kind = z.preprocess((v) => {
  if (isUnknown(v)) return null;
  const s = String(v).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((LEAD_KINDS as readonly string[]).includes(s)) return s;
  if (/hotel|restaurant|restro|bhojnalay|mess|udupi/.test(s)) return "restaurant";
  if (/cafe|coffee|tea/.test(s)) return "cafe";
  if (/dhaba/.test(s)) return "dhaba";
  if (/cloud|delivery_only|ghost/.test(s)) return "cloud_kitchen";
  if (/bar|pub|brew/.test(s)) return "bar";
  if (/baker|cake|patisserie/.test(s)) return "bakery";
  if (/sweet|mithai|halwai/.test(s)) return "sweet_shop";
  return "other";
}, z.enum(LEAD_KINDS).nullable());

// The file's field names, as a person would write them. Accepts camelCase
// (the documented shape) and snake_case (what a spreadsheet export gives).
const restaurantSchema = z
  .object({
    name: z.preprocess((v) => (isUnknown(v) ? "" : String(v).trim()), z.string().min(1).max(120)),
    type: kind.optional(),
    kind: kind.optional(),
    cuisine: text(120).optional(),
    phone: text(32).optional(),
    whatsapp: text(32).optional(),
    email: text(120).optional(),
    contactPerson: text(120).optional(),
    contact_person: text(120).optional(),
    address: text(300).optional(),
    locality: text(120).optional(),
    pincode: text(12).optional(),
    lat: coord(6, 38).optional(),
    lon: coord(67, 98).optional(),
    lng: coord(67, 98).optional(),
    website: text(200).optional(),
    isWebsiteAvailable: flag.optional(),
    website_available: flag.optional(),
    isDigitalMenuAvailable: flag.optional(),
    digital_menu: flag.optional(),
    digitalMenuProvider: text(80).optional(),
    digital_menu_provider: text(80).optional(),
    isHardMenuAvailable: flag.optional(),
    hard_menu: flag.optional(),
    onZomato: flag.optional(),
    on_zomato: flag.optional(),
    onSwiggy: flag.optional(),
    on_swiggy: flag.optional(),
    acceptsOnlineOrders: flag.optional(),
    online_orders: flag.optional(),
    googleRating: rating.optional(),
    google_rating: rating.optional(),
    rating: rating.optional(),
    googleReviewCount: count.optional(),
    google_review_count: count.optional(),
    reviews: count.optional(),
    googleMapsUrl: text(500).optional(),
    google_maps_url: text(500).optional(),
    googlePlaceId: text(100).optional(),
    google_place_id: text(100).optional(),
    priceLevel: level.optional(),
    price_level: level.optional(),
    openingHours: text(200).optional(),
    opening_hours: text(200).optional(),
    seating: text(200).optional(),
    verified: flag.optional(),
    sourceUrl: text(500).optional(),
    source_url: text(500).optional(),
    imageUrl: url.optional(),
    image_url: url.optional(),
    image: url.optional(),
    photo: url.optional(),
    notes: text(2000).optional(),
  })
  .passthrough();

const fileSchema = z.object({
  city: text(120).optional(),
  state: text(120).optional(),
  generatedAt: text(40).optional(),
  generatedBy: text(80).optional(),
  restaurants: z.array(z.unknown()).min(1, "The file has no restaurants in it"),
});

// What import_leads_json() takes, one per restaurant. Null means unknown.
export interface ImportRow {
  name: string;
  kind: LeadKind | null;
  cuisine: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  contact_person: string | null;
  address: string | null;
  locality: string | null;
  pincode: string | null;
  lat: number | null;
  lon: number | null;
  website: string | null;
  website_known: boolean | null;
  digital_menu: boolean | null;
  digital_menu_provider: string | null;
  hard_menu: boolean | null;
  on_zomato: boolean | null;
  on_swiggy: boolean | null;
  online_orders: boolean | null;
  google_rating: number | null;
  google_review_count: number | null;
  google_maps_url: string | null;
  google_place_id: string | null;
  price_level: number | null;
  opening_hours: string | null;
  seating: string | null;
  source_url: string | null;
  image_url: string | null;
  notes: string | null;
  extra: Record<string, unknown>;
}

export interface ParsedImport {
  city: string | null;
  state: string | null;
  rows: ImportRow[];
  // Rows that could not be used, with the reason, so the uploader can fix
  // the file rather than wonder where a restaurant went.
  skipped: { index: number; reason: string }[];
}

const KNOWN_KEYS = new Set(Object.keys(restaurantSchema.shape));

const pick = <T>(...vals: (T | null | undefined)[]): T | null => {
  for (const v of vals) if (v !== null && v !== undefined) return v;
  return null;
};

// Turns the uploaded text into rows for the database, or throws with a
// message the uploader can act on.
export function parseLeadImport(jsonText: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("That is not valid JSON. Check for a missing comma or bracket.");
  }
  // A bare array is accepted too: people paste just the list.
  const file = fileSchema.safeParse(Array.isArray(data) ? { restaurants: data } : data);
  if (!file.success) {
    const issue = file.error.issues[0];
    if (issue?.path[0] === "restaurants" && issue.message === "Required") {
      throw new Error('The file needs a "restaurants" list.');
    }
    throw new Error(issue?.message ?? "The file is not in the expected shape.");
  }

  const rows: ImportRow[] = [];
  const skipped: ParsedImport["skipped"] = [];
  file.data.restaurants.forEach((raw, index) => {
    const parsed = restaurantSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      skipped.push({
        index,
        reason: issue?.path[0] === "name" ? "no name" : `${issue?.path.join(".")}: ${issue?.message}`,
      });
      return;
    }
    const r = parsed.data;
    const website = pick(r.website);
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!KNOWN_KEYS.has(k) && !isUnknown(v)) extra[k] = v;
    }
    rows.push({
      name: r.name,
      kind: pick(r.type, r.kind),
      cuisine: pick(r.cuisine),
      phone: pick(r.phone),
      whatsapp: pick(r.whatsapp),
      email: pick(r.email),
      contact_person: pick(r.contactPerson, r.contact_person),
      address: pick(r.address),
      locality: pick(r.locality),
      pincode: pick(r.pincode),
      lat: pick(r.lat),
      lon: pick(r.lon, r.lng),
      website,
      // A URL is a yes whatever the flag says; the flag alone can say no.
      website_known: website ? true : pick(r.isWebsiteAvailable, r.website_available),
      digital_menu: pick(r.isDigitalMenuAvailable, r.digital_menu),
      digital_menu_provider: pick(r.digitalMenuProvider, r.digital_menu_provider),
      hard_menu: pick(r.isHardMenuAvailable, r.hard_menu),
      on_zomato: pick(r.onZomato, r.on_zomato),
      on_swiggy: pick(r.onSwiggy, r.on_swiggy),
      online_orders: pick(r.acceptsOnlineOrders, r.online_orders),
      google_rating: pick(r.googleRating, r.google_rating, r.rating),
      google_review_count: pick(r.googleReviewCount, r.google_review_count, r.reviews),
      google_maps_url: pick(r.googleMapsUrl, r.google_maps_url),
      google_place_id: pick(r.googlePlaceId, r.google_place_id),
      price_level: pick(r.priceLevel, r.price_level),
      opening_hours: pick(r.openingHours, r.opening_hours),
      seating: pick(r.seating),
      source_url: pick(r.sourceUrl, r.source_url),
      image_url: pick(r.imageUrl, r.image_url, r.image, r.photo),
      notes: pick(r.notes),
      extra,
    });
  });

  return { city: file.data.city ?? null, state: file.data.state ?? null, rows, skipped };
}

// The file, with every field, for "Download template".
export function importTemplate(city: string, state: string): string {
  return JSON.stringify(
    {
      city,
      state,
      generatedAt: new Date().toISOString().slice(0, 10),
      generatedBy: "claude",
      restaurants: [
        {
          name: "Hotel Sai Palace",
          type: "restaurant",
          cuisine: "North Indian, Chinese",
          phone: "+91 98765 43210",
          whatsapp: "NA",
          email: "NA",
          contactPerson: "NA",
          address: "College Road, opposite BYK College",
          locality: "College Road",
          pincode: "422005",
          lat: "NA",
          lon: "NA",
          isWebsiteAvailable: false,
          website: "NA",
          isDigitalMenuAvailable: "NA",
          digitalMenuProvider: "NA",
          isHardMenuAvailable: "NA",
          onZomato: true,
          onSwiggy: true,
          acceptsOnlineOrders: true,
          googleRating: 4.3,
          googleReviewCount: 1240,
          googleMapsUrl: "https://www.google.com/maps/place/...",
          googlePlaceId: "NA",
          priceLevel: 2,
          openingHours: "11:00–23:00, closed Monday",
          seating: "NA",
          verified: false,
          sourceUrl: "https://www.google.com/maps/place/...",
          imageUrl: "NA",
          notes: "NA",
        },
      ],
    },
    null,
    2,
  );
}

// The prompt a person pastes into Claude (web search on) to get a file in
// this shape for one city. The rules at the top are what make the data
// usable: real places only, NA over a guess, a link for every rating.
export function claudePromptFor(city: string, state: string, howMany = 40): string {
  return `List ${howMany} real restaurants, cafés and dhabas in ${city}, ${state}, India that a small business would own (skip chains and hotels with 50+ rooms). Use web search; include only places you can actually find online.

Rules — these matter more than completeness:
1. Only real places you found. Never invent a restaurant, phone number, or rating.
2. If you do not know a value, write "NA". Do not guess. "NA" is a good answer.
3. A googleRating or googleReviewCount is allowed only if you also give the sourceUrl where you saw it. Otherwise write "NA" for both.
4. Set verified to false for every row.
5. Prefer places with no website of their own, or that are only on Zomato/Swiggy.
6. imageUrl: a direct link to a photo of the place only if one is already public on the web (the restaurant's own site or social page). Otherwise "NA". Never a Google Maps photo link.

Return a single JSON object, nothing else, in exactly this shape:

${importTemplate(city, state)}`;
}
