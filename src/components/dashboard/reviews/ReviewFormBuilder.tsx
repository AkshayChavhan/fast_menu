"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ExternalLink,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { saveReviewForm } from "@/app/dashboard/reviews/actions";
import type { ActionResult } from "@/app/dashboard/lib";
import type { ReviewFormSettings, ReviewQuestion } from "@/types/db";
import { REVIEW_MAX_QUESTIONS } from "@/lib/constants";
import { StarRating } from "@/components/reviews/StarRating";
import { Switch } from "@/components/dashboard/Switch";
import { CopyUrl } from "@/components/dashboard/CopyUrl";

const inputCls =
  "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:ring-brand-900/40";

const cardCls =
  "rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";

// Fresh ids for questions the owner adds. crypto.randomUUID is available in
// every browser this app targets; the fallback keeps it from throwing in
// older embedded webviews.
function newQuestionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ReviewFormBuilder({
  restaurantId,
  slug,
  reviewUrl,
  isPublished,
  initial,
}: {
  restaurantId: string;
  slug: string;
  reviewUrl: string;
  isPublished: boolean;
  initial: ReviewFormSettings;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(saveReviewForm, null);

  const [enabled, setEnabled] = useState(initial.is_enabled);
  const [askName, setAskName] = useState(initial.ask_name);
  const [askComment, setAskComment] = useState(initial.ask_comment);
  const [showOnMenu, setShowOnMenu] = useState(initial.show_on_menu);
  const [questions, setQuestions] = useState<ReviewQuestion[]>(
    initial.questions,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const addQuestion = () =>
    setQuestions((qs) =>
      qs.length >= REVIEW_MAX_QUESTIONS
        ? qs
        : [...qs, { id: newQuestionId(), prompt: "" }],
    );

  const updateQuestion = (id: string, prompt: string) =>
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, prompt } : q)));

  const removeQuestion = (id: string) =>
    setQuestions((qs) => qs.filter((q) => q.id !== id));

  const move = (index: number, delta: number) =>
    setQuestions((qs) => {
      const target = index + delta;
      if (target < 0 || target >= qs.length) return qs;
      const next = [...qs];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  // Blank prompts are dropped rather than rejected, so a half-typed row the
  // owner abandoned doesn't block the whole save.
  const cleanedQuestions = questions
    .map((q) => ({ ...q, prompt: q.prompt.trim() }))
    .filter((q) => q.prompt.length > 0);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="is_enabled" value={String(enabled)} />
      <input type="hidden" name="ask_name" value={String(askName)} />
      <input type="hidden" name="ask_comment" value={String(askComment)} />
      <input type="hidden" name="show_on_menu" value={String(showOnMenu)} />
      <input
        type="hidden"
        name="questions"
        value={JSON.stringify(cleanedQuestions)}
      />

      {/* Live link */}
      <div className={cardCls}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Review page</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Guests land here when they scan your review QR code.
            </p>
          </div>
          <Switch
            checked={enabled}
            onChange={setEnabled}
            tone="green"
            label="Review page enabled"
          />
        </div>

        <div className="mt-4">
          <CopyUrl url={reviewUrl} />
        </div>

        <a
          href={reviewUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline"
        >
          Open review page <ExternalLink className="h-3 w-3" />
        </a>

        {!enabled ? (
          <p className="mt-3 rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            The review page is turned off. Anyone who scans the code will see a
            not-found page until you switch it back on.
          </p>
        ) : !isPublished ? (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Your menu isn&apos;t published yet, so the review page isn&apos;t
            reachable either. Publish it from Settings.
          </p>
        ) : null}
      </div>

      {/* Wording */}
      <div className={cardCls}>
        <h2 className="text-sm font-semibold">Page wording</h2>

        <label className="mt-4 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
          Headline
          <input
            name="headline"
            defaultValue={initial.headline}
            maxLength={120}
            required
            className={`mt-1 ${inputCls}`}
          />
        </label>

        <label className="mt-4 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
          Intro <span className="font-normal text-neutral-400">(optional)</span>
          <textarea
            name="intro"
            defaultValue={initial.intro ?? ""}
            maxLength={500}
            rows={2}
            className={`mt-1 ${inputCls}`}
          />
        </label>

        <label className="mt-4 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
          Thank-you message
          <input
            name="thank_you_message"
            defaultValue={initial.thank_you_message}
            maxLength={300}
            required
            className={`mt-1 ${inputCls}`}
          />
          <span className="mt-1 block font-normal text-neutral-400">
            Shown after a guest submits.
          </span>
        </label>
      </div>

      {/* Questions */}
      <div className={cardCls}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Star questions</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Each one shows a row of 5 stars. Guests tap to light them up.
            </p>
          </div>
          <span className="shrink-0 text-xs text-neutral-400">
            {cleanedQuestions.length}/{REVIEW_MAX_QUESTIONS}
          </span>
        </div>

        <div className="mt-4 space-y-2">
          {questions.map((q, i) => (
            <div
              key={q.id}
              className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-700"
            >
              <div className="flex flex-col text-neutral-300 dark:text-neutral-600">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move question up"
                  className="px-1 text-[10px] leading-none disabled:opacity-30 hover:text-neutral-500"
                >
                  ▲
                </button>
                <GripVertical className="h-3 w-3" aria-hidden />
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === questions.length - 1}
                  aria-label="Move question down"
                  className="px-1 text-[10px] leading-none disabled:opacity-30 hover:text-neutral-500"
                >
                  ▼
                </button>
              </div>

              <input
                value={q.prompt}
                onChange={(e) => updateQuestion(q.id, e.target.value)}
                placeholder="e.g. How was the food?"
                maxLength={160}
                className={inputCls}
              />

              <button
                type="button"
                onClick={() => removeQuestion(q.id)}
                aria-label="Remove question"
                className="shrink-0 rounded-lg p-2 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          {questions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 px-3 py-6 text-center text-xs text-neutral-500 dark:border-neutral-700">
              No star questions. Guests will only be asked for a comment.
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={addQuestion}
          disabled={questions.length >= REVIEW_MAX_QUESTIONS}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <Plus className="h-3.5 w-3.5" /> Add question
        </button>
      </div>

      {/* What else to collect */}
      <div className={cardCls}>
        <h2 className="text-sm font-semibold">What else to collect</h2>

        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Ask for a name</p>
            <p className="text-xs text-neutral-500">
              Optional for the guest. Shown with their review.
            </p>
          </div>
          <Switch checked={askName} onChange={setAskName} label="Ask for a name" />
        </div>

        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Ask for a comment</p>
            <p className="text-xs text-neutral-500">
              The words that float across your menu once approved.
            </p>
          </div>
          <Switch
            checked={askComment}
            onChange={setAskComment}
            label="Ask for a comment"
          />
        </div>

        {askComment ? (
          <label className="mt-4 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Comment label
            <input
              name="comment_label"
              defaultValue={initial.comment_label}
              maxLength={160}
              required
              className={`mt-1 ${inputCls}`}
            />
          </label>
        ) : (
          // The field is required server-side, so keep sending the saved value
          // even while the input is hidden.
          <input
            type="hidden"
            name="comment_label"
            value={initial.comment_label}
          />
        )}

        <div className="mt-5 flex items-center justify-between gap-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <div>
            <p className="text-sm font-medium">Show reviews on the menu</p>
            <p className="text-xs text-neutral-500">
              Approved reviews drift across the bottom of your public menu.
            </p>
          </div>
          <Switch
            checked={showOnMenu}
            onChange={setShowOnMenu}
            label="Show reviews on the menu"
          />
        </div>
      </div>

      {/* Preview */}
      <div className={cardCls}>
        <h2 className="text-sm font-semibold">Preview</h2>
        <div className="mt-4 rounded-lg bg-neutral-50 p-4 dark:bg-neutral-950/50">
          <p className="text-base font-bold">{initial.headline}</p>
          <div className="mt-4 space-y-3">
            {cleanedQuestions.map((q) => (
              <div key={q.id}>
                <p className="text-xs text-neutral-600 dark:text-neutral-300">
                  {q.prompt}
                </p>
                <StarRating value={0} onChange={() => {}} size="sm" className="mt-1" />
              </div>
            ))}
            {cleanedQuestions.length === 0 ? (
              <p className="text-xs text-neutral-400">No star questions yet.</p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save review form
        </button>

        {state?.ok ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
            <Check className="h-4 w-4" /> Saved
          </span>
        ) : null}
        {state && !state.ok ? (
          <span className="text-sm text-red-600">{state.error}</span>
        ) : null}
      </div>
    </form>
  );
}
