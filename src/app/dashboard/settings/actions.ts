"use server";

import { revalidatePath } from "next/cache";

import { isValidTimezone } from "@/lib/time";
import { z } from "zod";
import { requireRestaurantAccess, type ActionResult } from "../lib";
import { slugify } from "@/lib/utils";
import { CURRENCIES, SUPPORTED_LOCALES } from "@/lib/constants";
import { normalizeGoogleReviewUrl } from "@/lib/google-review";

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
    currency: String(formData.get("currency") ?? "USD"),
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
  revalidatePath("/dashboard/qr");
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

  const { error } = await guard.supabase
    .from("restaurants")
    .update({ logo_url: logoUrl })
    .eq("id", restaurantId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/settings");
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
    timezone: String(formData.get("timezone") ?? "UTC"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { restaurantId, ...settings } = parsed.data;

  const guard = await requireRestaurantAccess(restaurantId, "settings:manage");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase
    .from("restaurants")
    .update(settings)
    .eq("id", restaurantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/settings");
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
  revalidatePath("/waiter");
  return { ok: true };
}
