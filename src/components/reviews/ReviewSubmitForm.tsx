"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { submitReview, type SubmitResult } from "@/app/r/[slug]/actions";
import type { ReviewFormSettings } from "@/types/db";
import {
  REVIEW_MAX_COMMENT_LENGTH,
  REVIEW_MAX_NAME_LENGTH,
} from "@/lib/constants";
import { StarRating } from "@/components/reviews/StarRating";

const inputCls =
  "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:ring-brand-900/40";

export function ReviewSubmitForm({
  slug,
  settings,
}: {
  slug: string;
  settings: ReviewFormSettings;
}) {
  const [state, formAction, pending] = useActionState<
    SubmitResult | null,
    FormData
  >(submitReview, null);

  // question id -> stars. Unanswered questions are simply absent, which is how
  // a guest skips one.
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");

  if (state?.ok) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 px-6 py-12 text-center dark:border-green-900/50 dark:bg-green-950/30">
        <CheckCircle2
          className="mx-auto h-10 w-10 text-green-600 dark:text-green-400"
          aria-hidden
        />
        <p className="mt-4 text-base font-semibold text-green-900 dark:text-green-200">
          {state.message}
        </p>
        <p className="mt-1.5 text-xs text-green-700/80 dark:text-green-300/70">
          Your review will appear once the restaurant approves it.
        </p>
      </div>
    );
  }

  const payload = Object.entries(answers).map(([question_id, rating]) => ({
    question_id,
    rating,
  }));

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="answers" value={JSON.stringify(payload)} />

      {settings.questions.length > 0 ? (
        <ul className="space-y-4">
          {settings.questions.map((q) => (
            <li
              key={q.id}
              className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <p className="text-sm font-medium">{q.prompt}</p>
              <StarRating
                label={q.prompt}
                value={answers[q.id] ?? 0}
                onChange={(next) =>
                  setAnswers((prev) => ({ ...prev, [q.id]: next }))
                }
                size="lg"
                className="mt-2"
              />
            </li>
          ))}
        </ul>
      ) : null}

      {settings.ask_comment ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <label
            htmlFor="review-comment"
            className="text-sm font-medium"
          >
            {settings.comment_label}
          </label>
          <textarea
            id="review-comment"
            name="comment"
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={REVIEW_MAX_COMMENT_LENGTH}
            className={`mt-2 ${inputCls}`}
          />
          <p className="mt-1 text-right text-xs text-neutral-400">
            {comment.length}/{REVIEW_MAX_COMMENT_LENGTH}
          </p>
        </div>
      ) : null}

      {settings.ask_name ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <label htmlFor="review-name" className="text-sm font-medium">
            Your name{" "}
            <span className="font-normal text-neutral-400">(optional)</span>
          </label>
          <input
            id="review-name"
            name="guest_name"
            type="text"
            autoComplete="name"
            maxLength={REVIEW_MAX_NAME_LENGTH}
            className={`mt-2 ${inputCls}`}
          />
        </div>
      ) : null}

      {state && !state.ok ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Submit review
      </button>
    </form>
  );
}
