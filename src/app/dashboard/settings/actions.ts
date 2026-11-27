"use server";

import { revalidatePath } from "next/cache";

import { invalidateRestaurants } from "@/lib/menu-cache";
import { VIDEO_BUCKET, videoPathForRestaurant, videoPathFromUrl } from "@/lib/storage-url";
import { canonicalYoutubeUrl, youtubeIdFromUrl } from "@/lib/video-link";

import { isValidTimezone } from "@/lib/time";
import { z } from "zod";
import { requireRestaurantAccess, getPlan, type ActionResult } from "../lib";
import { localeLimit, planAllows, UPGRADE_PROMPTS } from "@/lib/plans";
import { removeRestaurantImages } from "@/lib/storage-cleanup";
import { slugify } from "@/lib/utils";
import { CURRENCIES, SUPPORTED_LOCALES } from "@/lib/constants";
import { normalizeGoogleReviewUrl } from "@/lib/google-review";
import { GSTIN_PATTERN, TAX_MODES, normalizeGstin } from "@/lib/bill-tax";

const CURRENCY_VALUES = CURRENCIES as readonly string[];
const LOCALE_VALUES = SUPPORTED_LOCALES.map((l) => l.code);


const settingsSchema = z.object({
  restaurantId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(120),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(120)
    .transform((s) => slugify(s))
    .refine((s) => s.length > 0, "Slug must contain letters or numbers"),
  description: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => (s.length ? s : null))
    .nullable(),
  currency: z.enum(CURRENCY_VALUES as [string, ...string[]]),
  default_locale: z.enum(LOCALE_VALUES as [string, ...string[]]),
  locales: z
    .array(z.enum(LOCALE_VALUES as [string, ...string[]]))
    .min(1, "Pick at least one language"),
});

function parseForm(formData: FormData) {
  return {
    restaurantId: String(formData.get("restaurantId") ?? ""),
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    currency: String(formData.get("currency") ?? "INR"),
    default_locale: String(formData.get("default_locale") ?? "en"),
    locales: formData.getAll("locales").map(String),
  };
}

export async function updateRestaurantSettings(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(parseForm(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  // Ensure default_locale is included in the offered locales.
  const locales = Array.from(new Set(data.locales));
  if (!locales.includes(data.default_locale)) {
    locales.unshift(data.default_locale);
  }

  const guard = await requireRestaurantAccess(data.restaurantId, "settings:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  // Say no rather than silently dropping languages. The form holds its state,
  // so nothing else the owner typed is lost by rejecting the save.
  const limit = localeLimit(await getPlan(guard.supabase, data.restaurantId));
  if (locales.length > limit) {
    return {
      ok: false,
      error: `Your plan includes ${limit} languages. ${UPGRADE_PROMPTS.languages}`,
    };
  }

  const { error } = await guard.supabase
    .from("restaurants")
    .update({
      name: data.name,
      slug: data.slug,
      description: data.description,
      currency: data.currency,
      default_locale: data.default_locale,
      locales,
    })
    .eq("id", data.restaurantId);

  if (error) {
    // 23505 == unique_violation on slug.
    if (error.code === "23505") {
      return { ok: false, error: "That URL slug is already taken." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/dashboard/settings");
  invalidateRestaurants();
  revalidatePath("/dashboard");
  return { ok: true };
}

const publishSchema = z.object({
  restaurantId: z.string().uuid(),
  isPublished: z.boolean(),
});

export async function setPublished(
  restaurantId: string,
  isPublished: boolean,
): Promise<ActionResult> {
  const parsed = publishSchema.safeParse({ restaurantId, isPublished });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const guard = await requireRestaurantAccess(restaurantId, "settings:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase
    .from("restaurants")
    .update({ is_published: isPublished })
    .eq("id", restaurantId);

  if (error) {
    // P0001 is the restaurants_enforce_trial trigger.
    if (error.code === "P0001") {
      return {
        ok: false,
        error:
          "Publishing is switched off until your trial is approved. You can keep editing the menu.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  invalidateRestaurants();
  revalidatePath("/dashboard/qr");
  return { ok: true };
}

// A file in our own bucket, a YouTube video, or nothing. Any other URL is
// refused: the menu would otherwise embed whatever a client sent.
const heroVideoSchema = z.object({
  restaurantId: z.string().uuid(),
  videoUrl: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const id = youtubeIdFromUrl(v);
      if (id) return canonicalYoutubeUrl(id);
      if (/^https?:\/\//.test(v) && videoPathFromUrl(v)) return v;
      ctx.addIssue({ code: "custom", message: "Paste a YouTube link, or upload a file." });
      return z.NEVER;
    })
    .nullable(),
});

// The welcome-banner clip. Saved at once, like the logo; the previous file
// is removed only after the new URL is safely stored.
export async function updateHeroVideo(
  restaurantId: string,
  videoUrl: string | null,
): Promise<ActionResult> {
  const parsed = heroVideoSchema.safeParse({ restaurantId, videoUrl });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid video URL" };
  }
  // The canonical form, not whatever was pasted.
  videoUrl = parsed.data.videoUrl;

  const guard = await requireRestaurantAccess(restaurantId, "settings:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { data: current } = await guard.supabase
    .from("restaurants")
    .select("hero_video_url")
    .eq("id", restaurantId)
    .maybeSingle<{ hero_video_url: string | null }>();

  const { error } = await guard.supabase
    .from("restaurants")
    .update({ hero_video_url: videoUrl })
    .eq("id", restaurantId);
  if (error) return { ok: false, error: error.message };

  const old = videoPathForRestaurant(current?.hero_video_url, restaurantId);
  if (old && current?.hero_video_url !== videoUrl) {
    const { error: rmErr } = await guard.supabase.storage.from(VIDEO_BUCKET).remove([old]);
    if (rmErr) console.warn(`Could not remove ${old}: ${rmErr.message}`);
  }

  revalidatePath("/dashboard/settings");
  invalidateRestaurants();
  revalidatePath("/dashboard");
  return { ok: true };
}

const logoSchema = z.object({
  restaurantId: z.string().uuid(),
  logoUrl: z.string().url().nullable(),
});

export async function updateLogo(
  restaurantId: string,
  logoUrl: string | null,
): Promise<ActionResult> {
  const parsed = logoSchema.safeParse({ restaurantId, logoUrl });
  if (!parsed.success) return { ok: false, error: "Invalid logo URL" };

  const guard = await requireRestaurantAccess(restaurantId, "settings:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { data: current } = await guard.supabase
    .from("restaurants")
    .select("logo_url")
    .eq("id", restaurantId)
    .maybeSingle<{ logo_url: string | null }>();

  const { error } = await guard.supabase
    .from("restaurants")
    .update({ logo_url: logoUrl })
    .eq("id", restaurantId);

  if (error) return { ok: false, error: error.message };

  // The old logo is unreferenced now; drop it rather than let it pile up.
  await removeRestaurantImages(guard.supabase, restaurantId, [current?.logo_url], logoUrl);

  revalidatePath("/dashboard/settings");
  invalidateRestaurants();
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Ordering switches. Owner-only, like every other restaurants update; the
// pause switch below is the one thing managers may flip.
// ---------------------------------------------------------------------------

// Checkboxes/switches are posted as explicit "true"/"false" strings so an
// unchecked box is a real `false` rather than a missing key.
const asBool = (v: FormDataEntryValue | null) => String(v ?? "false") === "true";

const orderingSchema = z.object({
  restaurantId: z.string().uuid(),
  ordering_enabled: z.boolean(),
  allow_takeaway: z.boolean(),
  table_qr_enabled: z.boolean(),
  kds_enabled: z.boolean(),
  timezone: z
    .string()
    .trim()
    .min(1, "Pick a timezone")
    .max(64)
    .refine(isValidTimezone, "That isn't a valid timezone"),
});

export async function updateOrderingSettings(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = orderingSchema.safeParse({
    restaurantId: String(formData.get("restaurantId") ?? ""),
    ordering_enabled: asBool(formData.get("ordering_enabled")),
    allow_takeaway: asBool(formData.get("allow_takeaway")),
    table_qr_enabled: asBool(formData.get("table_qr_enabled")),
    kds_enabled: asBool(formData.get("kds_enabled")),
    timezone: String(formData.get("timezone") ?? "Asia/Kolkata"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { restaurantId, ...settings } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "settings:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  // The timezone is free — reports and schedules read it whatever the plan.
  // The four switches are the Pro feature, so a starter account may save this
  // form but may not turn any of them on. place_order() and
  // staff_create_order() check the plan again at order time, which is what
  // covers a restaurant that had them on and then downgraded.
  if (!planAllows(await getPlan(guard.supabase, restaurantId), "ordering")) {
    if (
      settings.ordering_enabled ||
      settings.allow_takeaway ||
      settings.table_qr_enabled ||
      settings.kds_enabled
    ) {
      return { ok: false, error: UPGRADE_PROMPTS.ordering };
    }
  }

  const { error } = await guard.supabase
    .from("restaurants")
    .update(settings)
    .eq("id", restaurantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/settings");
  invalidateRestaurants();
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/qr");
  revalidatePath("/waiter");
  revalidatePath("/kitchen");
  return { ok: true };
}

const integrationsSchema = z.object({
  restaurantId: z.string().uuid(),
  google_review_url: z.string().max(1000),
});

export async function updateIntegrations(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = integrationsSchema.safeParse({
    restaurantId: String(formData.get("restaurantId") ?? ""),
    google_review_url: String(formData.get("google_review_url") ?? ""),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const link = normalizeGoogleReviewUrl(parsed.data.google_review_url);
  if (!link.ok) return { ok: false, error: link.error };

  const guard = await requireRestaurantAccess(parsed.data.restaurantId, "settings:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase
    .from("restaurants")
    .update({ google_review_url: link.url })
    .eq("id", parsed.data.restaurantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/settings");
  invalidateRestaurants();
  return { ok: true };
}

const pauseSchema = z.object({
  restaurantId: z.string().uuid(),
  paused: z.boolean(),
  message: z.string().trim().max(200, "Keep the message under 200 characters"),
});

// Owners and managers. Goes through set_ordering_paused() because managers
// cannot update restaurants directly.
export async function setOrderingPaused(input: {
  restaurantId: string;
  paused: boolean;
  message: string;
}): Promise<ActionResult> {
  const parsed = pauseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const guard = await requireRestaurantAccess(parsed.data.restaurantId, "ordering:pause");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase.rpc("set_ordering_paused", {
    rid: parsed.data.restaurantId,
    paused: parsed.data.paused,
    message: parsed.data.message,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings");
  invalidateRestaurants();
  revalidatePath("/waiter");
  return { ok: true };
}

// --- Bill & taxes -------------------------------------------------------------

// "5" or "2.5" (percent, as the owner types it) -> basis points. Empty is 0.
function percentToBp(v: FormDataEntryValue | null): number {
  const s = String(v ?? "").trim().replace("%", "");
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}

// "20" or "20.50" (rupees) -> paise. Empty is 0.
function rupeesToCents(v: FormDataEntryValue | null): number {
  const s = String(v ?? "").trim().replace(/[₹,\s]/g, "");
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}

const billingSchema = z
  .object({
    restaurantId: z.string().uuid(),
    tax_mode: z.enum(TAX_MODES as [string, ...string[]]),
    gst_rate_bp: z
      .number({ message: "Enter the GST rate as a number, like 5 or 18" })
      .int()
      .min(0, "The GST rate can't be negative")
      .max(2800, "The GST rate can't be above 28%"),
    gstin: z
      .string()
      .transform(normalizeGstin)
      .refine((g) => g === "" || GSTIN_PATTERN.test(g), "That GSTIN doesn't look right: it has 15 characters, like 27AAPFU0939F1ZV")
      .transform((g) => (g === "" ? null : g)),
    prices_include_tax: z.boolean(),
    liquor_vat_bp: z
      .number({ message: "Enter the liquor VAT as a number, like 10" })
      .int()
      .min(0, "VAT can't be negative")
      .max(5000, "VAT can't be above 50%"),
    packaging_cents: z
      .number({ message: "Enter the packaging charge in rupees, like 20" })
      .int()
      .min(0, "The packaging charge can't be negative")
      .max(100000, "The packaging charge can't be above ₹1,000"),
    round_off: z.boolean(),
    liquorCategoryIds: z.array(z.string().uuid()),
  })
  .refine((d) => d.tax_mode === "none" || d.gstin !== null, {
    message: "Enter your GSTIN. It is printed on every bill when you charge GST.",
  })
  .refine((d) => d.tax_mode !== "gst" || d.gst_rate_bp > 0, {
    message: "Enter a GST rate above 0%, or choose \"Not registered\".",
  });

// Save Settings -> Bill & taxes: the restaurant's tax settings, and which
// categories are liquor (taxed with VAT rather than GST).
export async function updateBillingSettings(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = billingSchema.safeParse({
    restaurantId: String(formData.get("restaurantId") ?? ""),
    tax_mode: String(formData.get("tax_mode") ?? "none"),
    gst_rate_bp: percentToBp(formData.get("gst_rate")),
    gstin: String(formData.get("gstin") ?? ""),
    prices_include_tax: asBool(formData.get("prices_include_tax")),
    liquor_vat_bp: percentToBp(formData.get("liquor_vat")),
    packaging_cents: rupeesToCents(formData.get("packaging")),
    round_off: asBool(formData.get("round_off")),
    liquorCategoryIds: formData.getAll("liquor_category").map(String),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { restaurantId, liquorCategoryIds, ...settings } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "settings:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase
    .from("restaurants")
    .update(settings)
    .eq("id", restaurantId);
  if (error) return { ok: false, error: error.message };

  // Every category is one or the other; both writes are scoped to this
  // restaurant, so ids from anywhere else simply match nothing.
  const liquor = guard.supabase
    .from("categories")
    .update({ tax_class: "liquor" })
    .eq("restaurant_id", restaurantId)
    .in("id", liquorCategoryIds.length > 0 ? liquorCategoryIds : ["00000000-0000-0000-0000-000000000000"]);
  let food = guard.supabase
    .from("categories")
    .update({ tax_class: "food" })
    .eq("restaurant_id", restaurantId);
  if (liquorCategoryIds.length > 0) food = food.not("id", "in", `(${liquorCategoryIds.join(",")})`);
  const [liquorRes, foodRes] = await Promise.all([liquor, food]);
  const catErr = liquorRes.error ?? foodRes.error;
  if (catErr) return { ok: false, error: `Taxes saved, but not the liquor categories: ${catErr.message}` };

  revalidatePath("/dashboard/settings");
  invalidateRestaurants();
  return { ok: true };
}
