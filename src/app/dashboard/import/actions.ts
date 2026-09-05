"use server";

import { revalidatePath } from "next/cache";

import { requireOwnedRestaurant } from "../lib";
import {
  parseMenuFile,
  IMPORT_MAX_BYTES,
  type NormalizedMenu,
} from "@/lib/menu-import";

export interface ImportPreview {
  counts: { categories: number; dishes: number };
  /** What the replace would remove — shown before the user commits. */
  replacing: { categories: number; dishes: number };
  warnings: string[];
}

export type PreviewResult =
  | { ok: true; preview: ImportPreview }
  | { ok: false; error: string };

export type ApplyResult =
  | { ok: true; imported: { categories: number; dishes: number } }
  | { ok: false; error: string };

// Shared front half of both actions: authorise, read the restaurant's locales,
// and turn the uploaded text into a normalised menu. Doing this again inside
// apply() (rather than trusting a payload the preview returned) means the
// client can't hand back something the preview never saw.
async function authorizeAndParse(restaurantId: string, rawText: string) {
  if (rawText.length > IMPORT_MAX_BYTES) {
    return {
      ok: false as const,
      error: `That file is too large (limit ${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)} MB).`,
    };
  }

  const guard = await requireOwnedRestaurant(restaurantId);
  if (!guard.ok) return { ok: false as const, error: guard.error };

  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return {
      ok: false as const,
      error: "That isn't valid JSON. Check for a stray comma or quote.",
    };
  }

  const { data: restaurant } = await guard.supabase
    .from("restaurants")
    .select("locales, default_locale")
    .eq("id", restaurantId)
    .maybeSingle<{ locales: string[]; default_locale: string }>();

  const offered = restaurant?.locales?.length
    ? restaurant.locales
    : [restaurant?.default_locale ?? "en"];

  const parsed = parseMenuFile(raw, offered);
  if (!parsed.ok) return { ok: false as const, error: parsed.error };

  return { ok: true as const, supabase: guard.supabase, parsed: parsed.parsed };
}

export async function previewImport(
  restaurantId: string,
  rawText: string,
): Promise<PreviewResult> {
  const ready = await authorizeAndParse(restaurantId, rawText);
  if (!ready.ok) return { ok: false, error: ready.error };

  // head:true returns the count without transferring any rows.
  const [catRes, dishRes] = await Promise.all([
    ready.supabase
      .from("categories")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId),
    ready.supabase
      .from("dishes")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId),
  ]);

  return {
    ok: true,
    preview: {
      counts: ready.parsed.counts,
      replacing: {
        categories: catRes.count ?? 0,
        dishes: dishRes.count ?? 0,
      },
      warnings: ready.parsed.warnings,
    },
  };
}

export async function applyImport(
  restaurantId: string,
  slug: string,
  rawText: string,
): Promise<ApplyResult> {
  const ready = await authorizeAndParse(restaurantId, rawText);
  if (!ready.ok) return { ok: false, error: ready.error };

  const payload: NormalizedMenu = ready.parsed.menu;

  // import_menu() deletes and re-inserts inside one transaction, so a failure
  // here leaves the existing menu untouched rather than half-replaced.
  const { data, error } = await ready.supabase.rpc("import_menu", {
    rid: restaurantId,
    payload,
  });

  if (error) {
    // 42501 is the ownership guard inside the function.
    if (error.code === "42501") {
      return { ok: false, error: "You don't have access to this restaurant." };
    }
    if (error.code === "PGRST202") {
      return {
        ok: false,
        error:
          "The import_menu database function is missing. Run supabase/schema.sql in the Supabase SQL editor first.",
      };
    }
    return { ok: false, error: error.message };
  }

  const result = (data ?? {}) as { categories?: number; dishes?: number };

  revalidatePath("/dashboard/menu");
  revalidatePath("/dashboard/import");
  revalidatePath("/dashboard");
  revalidatePath(`/m/${slug}`);

  return {
    ok: true,
    imported: {
      categories: result.categories ?? 0,
      dishes: result.dishes ?? 0,
    },
  };
}
