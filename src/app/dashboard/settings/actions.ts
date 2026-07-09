"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";
import { CURRENCIES, SUPPORTED_LOCALES } from "@/lib/constants";

const CURRENCY_VALUES = CURRENCIES as readonly string[];
const LOCALE_VALUES = SUPPORTED_LOCALES.map((l) => l.code);

export type ActionResult = { ok: true } | { ok: false; error: string };

// Resolve the current user and assert they own the given restaurant. Returns
// the supabase client for the follow-up mutation. RLS also enforces ownership;
// this gives us friendlier errors and an explicit guard.
type OwnedRestaurant =
  | { ok: false; error: string }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
    };

async function requireOwnedRestaurant(
  restaurantId: string,
): Promise<OwnedRestaurant> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, owner_id")
    .eq("id", restaurantId)
    .maybeSingle();

  if (!restaurant || restaurant.owner_id !== user.id) {
    return { ok: false, error: "Restaurant not found" };
  }
  return { ok: true, supabase, userId: user.id };
}

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

  const guard = await requireOwnedRestaurant(data.restaurantId);
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

  const guard = await requireOwnedRestaurant(restaurantId);
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase
    .from("restaurants")
    .update({ is_published: isPublished })
    .eq("id", restaurantId);

  if (error) return { ok: false, error: error.message };

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

  const guard = await requireOwnedRestaurant(restaurantId);
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
