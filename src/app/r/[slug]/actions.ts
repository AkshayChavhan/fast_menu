"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_REVIEW_SETTINGS,
  averageRating,
  normalizeQuestions,
} from "@/lib/reviews";
import {
  REVIEW_MAX_STARS,
  REVIEW_MAX_COMMENT_LENGTH,
  REVIEW_MAX_NAME_LENGTH,
} from "@/lib/constants";
import type { ReviewForm, ReviewRating } from "@/types/db";

export type SubmitResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const answerSchema = z.object({
  question_id: z.string().trim().min(1).max(80),
  rating: z.number().int().min(1).max(REVIEW_MAX_STARS),
});

const submitSchema = z.object({
  slug: z.string().trim().min(1).max(120),
  guest_name: z
    .string()
    .trim()
    .max(REVIEW_MAX_NAME_LENGTH)
    .transform((s) => (s.length ? s : null))
    .nullable(),
  comment: z
    .string()
    .trim()
    .max(
      REVIEW_MAX_COMMENT_LENGTH,
      `Please keep it under ${REVIEW_MAX_COMMENT_LENGTH} characters`,
    )
    .transform((s) => (s.length ? s : null))
    .nullable(),
  answers: z.array(answerSchema).max(50),
});

// Public, unauthenticated submission. Everything the browser sends is treated
// as hostile: the restaurant is resolved from the slug (never an id from the
// form), question wording is read back from the database rather than trusted
// from the client, and the row is written as 'pending' — which the RLS insert
// policy also pins, so it can't be bypassed by posting to this action directly.
export async function submitReview(
  _prev: SubmitResult | null,
  formData: FormData,
): Promise<SubmitResult> {
  let answers: unknown;
  try {
    answers = JSON.parse(String(formData.get("answers") ?? "[]"));
  } catch {
    return { ok: false, error: "Could not read your ratings" };
  }

  const parsed = submitSchema.safeParse({
    slug: String(formData.get("slug") ?? ""),
    guest_name: String(formData.get("guest_name") ?? ""),
    comment: String(formData.get("comment") ?? ""),
    answers,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check your answers",
    };
  }

  const { slug, guest_name, comment, answers: given } = parsed.data;
  const supabase = await createClient();

  // RLS hides unpublished/expired restaurants, so this doubles as the
  // "can this page be reached at all" check.
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id")
    .eq("slug", slug)
    .maybeSingle<{ id: string }>();

  if (!restaurant) {
    return { ok: false, error: "This review page is no longer available" };
  }

  const { data: form } = await supabase
    .from("review_forms")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .maybeSingle<ReviewForm>();

  if (form && !form.is_enabled) {
    return { ok: false, error: "This review page is no longer available" };
  }

  const questions = form
    ? normalizeQuestions(form.questions)
    : DEFAULT_REVIEW_SETTINGS.questions;
  const promptById = new Map(questions.map((q) => [q.id, q.prompt]));

  // Keep only answers to questions that actually exist on the live form, and
  // snapshot the wording from the database.
  const ratings: ReviewRating[] = [];
  const seen = new Set<string>();
  for (const a of given) {
    const prompt = promptById.get(a.question_id);
    if (!prompt || seen.has(a.question_id)) continue;
    seen.add(a.question_id);
    ratings.push({ question_id: a.question_id, prompt, rating: a.rating });
  }

  const askComment = form ? form.ask_comment : DEFAULT_REVIEW_SETTINGS.ask_comment;
  const askName = form ? form.ask_name : DEFAULT_REVIEW_SETTINGS.ask_name;

  // An empty submission is a misclick, not feedback.
  if (ratings.length === 0 && !(askComment && comment)) {
    return {
      ok: false,
      error:
        questions.length > 0
          ? "Please rate at least one question before submitting"
          : "Please write a short comment before submitting",
    };
  }

  const { error } = await supabase.from("reviews").insert({
    restaurant_id: restaurant.id,
    guest_name: askName ? guest_name : null,
    comment: askComment ? comment : null,
    ratings,
    overall_rating: averageRating(ratings),
    status: "pending",
  });

  if (error) {
    return { ok: false, error: "We couldn't save your review. Please try again." };
  }

  // The owner's moderation queue should show it immediately.
  revalidatePath("/dashboard/reviews");

  return {
    ok: true,
    message: form?.thank_you_message ?? DEFAULT_REVIEW_SETTINGS.thank_you_message,
  };
}
