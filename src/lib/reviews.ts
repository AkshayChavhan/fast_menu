import {
  DEFAULT_REVIEW_QUESTIONS,
  REVIEW_MAX_STARS,
} from "@/lib/constants";
import type {
  ReviewForm,
  ReviewFormSettings,
  ReviewQuestion,
  ReviewRating,
} from "@/types/db";

// The public review page lives on its own route so it can carry its own QR
// code, separate from the menu QR.
export function publicReviewPath(slug: string): string {
  return `/r/${slug}`;
}

// Settings a restaurant gets before it has ever saved the form. The dashboard
// shows these pre-filled and the public page renders them, so a brand-new
// account has a working review page with no setup.
export const DEFAULT_REVIEW_SETTINGS: ReviewFormSettings = {
  is_enabled: true,
  headline: "How was your visit?",
  intro: "Your feedback takes less than a minute and helps us get better.",
  questions: DEFAULT_REVIEW_QUESTIONS.map((q) => ({ ...q })),
  ask_name: true,
  ask_comment: true,
  comment_label: "Anything else you'd like to share?",
  thank_you_message: "Thank you for your feedback!",
  show_on_menu: true,
};

// `questions` is jsonb, so it can be anything if hand-edited in the SQL editor.
// Coerce it to a well-formed list and drop entries we can't use.
export function normalizeQuestions(value: unknown): ReviewQuestion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: ReviewQuestion[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const { id, prompt } = raw as Record<string, unknown>;
    if (typeof id !== "string" || typeof prompt !== "string") continue;
    const trimmed = prompt.trim();
    if (!id || !trimmed || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, prompt: trimmed });
  }
  return out;
}

// Same defensive treatment for a review's stored answers.
export function normalizeRatings(value: unknown): ReviewRating[] {
  if (!Array.isArray(value)) return [];
  const out: ReviewRating[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const { question_id, prompt, rating } = raw as Record<string, unknown>;
    if (typeof rating !== "number" || !Number.isFinite(rating)) continue;
    const clamped = Math.min(REVIEW_MAX_STARS, Math.max(1, Math.round(rating)));
    out.push({
      question_id: typeof question_id === "string" ? question_id : "",
      prompt: typeof prompt === "string" ? prompt : "",
      rating: clamped,
    });
  }
  return out;
}

// Collapse a saved row (or its absence) into the editable settings shape.
export function settingsFromForm(
  form: ReviewForm | null | undefined,
): ReviewFormSettings {
  if (!form) return { ...DEFAULT_REVIEW_SETTINGS };

  const questions = normalizeQuestions(form.questions);
  return {
    is_enabled: form.is_enabled,
    headline: form.headline,
    intro: form.intro,
    // A saved form with zero questions is a deliberate choice (comment-only),
    // so it is preserved rather than re-seeded with the defaults.
    questions,
    ask_name: form.ask_name,
    ask_comment: form.ask_comment,
    comment_label: form.comment_label,
    thank_you_message: form.thank_you_message,
    show_on_menu: form.show_on_menu,
  };
}

// Mean star rating across a submission's answers, rounded to one decimal.
// Null when there were no star questions to answer.
export function averageRating(ratings: ReviewRating[]): number | null {
  if (ratings.length === 0) return null;
  const total = ratings.reduce((sum, r) => sum + r.rating, 0);
  return Math.round((total / ratings.length) * 10) / 10;
}
