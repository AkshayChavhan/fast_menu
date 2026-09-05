"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnedRestaurant, type ActionResult } from "../lib";
import { REVIEW_MAX_QUESTIONS } from "@/lib/constants";

// The public review page and the menu's floating words both read this data,
// so every mutation busts them alongside the dashboard.
function revalidateReviewSurfaces(slug: string) {
  revalidatePath("/dashboard/reviews");
  revalidatePath("/dashboard/reviews/settings");
  revalidatePath(`/r/${slug}`);
  revalidatePath(`/m/${slug}`);
}

const questionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1, "A question can't be empty").max(160),
});

const formSchema = z.object({
  restaurantId: z.string().uuid(),
  slug: z.string().trim().min(1),
  is_enabled: z.boolean(),
  headline: z.string().trim().min(1, "Headline is required").max(120),
  intro: z
    .string()
    .trim()
    .max(500)
    .transform((s) => (s.length ? s : null))
    .nullable(),
  questions: z
    .array(questionSchema)
    .max(REVIEW_MAX_QUESTIONS, `At most ${REVIEW_MAX_QUESTIONS} questions`)
    // Duplicate ids would make two rows of stars share one answer.
    .refine(
      (qs) => new Set(qs.map((q) => q.id)).size === qs.length,
      "Duplicate question ids",
    ),
  ask_name: z.boolean(),
  ask_comment: z.boolean(),
  comment_label: z.string().trim().min(1).max(160),
  thank_you_message: z.string().trim().min(1).max(300),
  show_on_menu: z.boolean(),
});

// Checkboxes/switches are posted as explicit "true"/"false" strings so an
// unchecked box is a real `false` rather than a missing key.
const asBool = (v: FormDataEntryValue | null) => String(v ?? "false") === "true";

export async function saveReviewForm(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  let questions: unknown;
  try {
    questions = JSON.parse(String(formData.get("questions") ?? "[]"));
  } catch {
    return { ok: false, error: "Could not read the question list" };
  }

  const parsed = formSchema.safeParse({
    restaurantId: String(formData.get("restaurantId") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    is_enabled: asBool(formData.get("is_enabled")),
    headline: String(formData.get("headline") ?? ""),
    intro: String(formData.get("intro") ?? ""),
    questions,
    ask_name: asBool(formData.get("ask_name")),
    ask_comment: asBool(formData.get("ask_comment")),
    comment_label: String(formData.get("comment_label") ?? ""),
    thank_you_message: String(formData.get("thank_you_message") ?? ""),
    show_on_menu: asBool(formData.get("show_on_menu")),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const { restaurantId, slug, ...settings } = parsed.data;

  const guard = await requireOwnedRestaurant(restaurantId);
  if (!guard.ok) return { ok: false, error: guard.error };

  // One form per restaurant (unique constraint on restaurant_id), so upsert on
  // that column rather than reading first to decide insert vs update.
  const { error } = await guard.supabase
    .from("review_forms")
    .upsert({ restaurant_id: restaurantId, ...settings }, {
      onConflict: "restaurant_id",
    });

  if (error) return { ok: false, error: error.message };

  revalidateReviewSurfaces(slug);
  return { ok: true };
}

const statusSchema = z.object({
  reviewId: z.string().uuid(),
  restaurantId: z.string().uuid(),
  slug: z.string().trim().min(1),
  status: z.enum(["pending", "approved", "hidden"]),
});

export async function setReviewStatus(input: {
  reviewId: string;
  restaurantId: string;
  slug: string;
  status: "pending" | "approved" | "hidden";
}): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const guard = await requireOwnedRestaurant(parsed.data.restaurantId);
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase
    .from("reviews")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.reviewId)
    // Scope to the restaurant we just authorised, so a mismatched pair can't
    // touch someone else's row even before RLS weighs in.
    .eq("restaurant_id", parsed.data.restaurantId);

  if (error) return { ok: false, error: error.message };

  revalidateReviewSurfaces(parsed.data.slug);
  return { ok: true };
}

const deleteSchema = statusSchema.omit({ status: true });

export async function deleteReview(input: {
  reviewId: string;
  restaurantId: string;
  slug: string;
}): Promise<ActionResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const guard = await requireOwnedRestaurant(parsed.data.restaurantId);
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await guard.supabase
    .from("reviews")
    .delete()
    .eq("id", parsed.data.reviewId)
    .eq("restaurant_id", parsed.data.restaurantId);

  if (error) return { ok: false, error: error.message };

  revalidateReviewSurfaces(parsed.data.slug);
  return { ok: true };
}
