"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, EyeOff, Loader2, Trash2, Undo2 } from "lucide-react";

import {
  setReviewStatus,
  deleteReview,
} from "@/app/dashboard/reviews/actions";
import type { Review, ReviewStatus } from "@/types/db";
import { StarRating } from "@/components/reviews/StarRating";
import { cn } from "@/lib/utils";

const TABS: { id: ReviewStatus; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "hidden", label: "Hidden" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ReviewModerationList({
  reviews,
  restaurantId,
  slug,
}: {
  reviews: Review[];
  restaurantId: string;
  slug: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<ReviewStatus>(
    // Land on whichever tab actually has something to do.
    reviews.some((r) => r.status === "pending") ? "pending" : "approved",
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = {
    pending: reviews.filter((r) => r.status === "pending").length,
    approved: reviews.filter((r) => r.status === "approved").length,
    hidden: reviews.filter((r) => r.status === "hidden").length,
  };

  const shown = reviews.filter((r) => r.status === tab);

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else router.refresh();
    });
  }

  const changeStatus = (id: string, status: ReviewStatus) =>
    run(id, () =>
      setReviewStatus({ reviewId: id, restaurantId, slug, status }),
    );

  const remove = (id: string) =>
    run(id, () => deleteReview({ reviewId: id, restaurantId, slug }));

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t.id
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200",
            )}
          >
            {t.label}
            <span className="ml-1.5 text-neutral-400">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-500 dark:border-neutral-700">
          Nothing in {TABS.find((t) => t.id === tab)?.label.toLowerCase()}.
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((review) => {
            const busy = busyId === review.id && pending;
            return (
              <li
                key={review.id}
                className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold">
                    {review.guest_name?.trim() || "Anonymous guest"}
                  </span>
                  {review.overall_rating !== null ? (
                    <span className="inline-flex items-center gap-1.5">
                      <StarRating value={review.overall_rating} size="sm" />
                      <span className="text-xs text-neutral-500">
                        {review.overall_rating.toFixed(1)}
                      </span>
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-neutral-400">
                    {formatDate(review.created_at)}
                  </span>
                </div>

                {review.comment ? (
                  <p className="mt-2 whitespace-pre-line text-sm text-neutral-700 dark:text-neutral-300">
                    {review.comment}
                  </p>
                ) : null}

                {review.ratings.length > 0 ? (
                  <dl className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    {review.ratings.map((r, i) => (
                      <div
                        key={`${r.question_id}-${i}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <dt className="truncate text-xs text-neutral-500">
                          {r.prompt}
                        </dt>
                        <dd className="shrink-0">
                          <StarRating value={r.rating} size="sm" />
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
                  ) : null}

                  {review.status !== "approved" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => changeStatus(review.id, "approved")}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </button>
                  ) : null}

                  {review.status !== "hidden" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => changeStatus(review.id, "hidden")}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      <EyeOff className="h-3.5 w-3.5" /> Hide
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => changeStatus(review.id, "pending")}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Move to pending
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(review.id)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
