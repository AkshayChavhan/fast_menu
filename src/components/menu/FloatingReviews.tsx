import type { CSSProperties } from "react";
import { Quote } from "lucide-react";

import { StarRating } from "@/components/reviews/StarRating";
import type { Review } from "@/types/db";

// Approved guest reviews drifting across the bottom of the public menu.
//
// A server component: the animation is pure CSS, so none of this needs to ship
// as client JavaScript. The bubbles are rendered twice and the track slides
// half its width, which is what makes the loop seamless.
export function FloatingReviews({ reviews }: { reviews: Review[] }) {
  if (reviews.length === 0) return null;

  // Longer strips need proportionally longer to pass by, otherwise a wall of
  // reviews whips past unreadably.
  const duration = Math.max(24, reviews.length * 9);

  const bubbles = reviews.map((review) => (
    <figure
      key={review.id}
      className="flex w-72 shrink-0 flex-col rounded-2xl border border-neutral-200/80 bg-white px-4 py-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
    >
      <Quote
        className="h-3.5 w-3.5 shrink-0 text-brand-300 dark:text-brand-700"
        aria-hidden
      />
      <blockquote className="mt-1.5 line-clamp-4 text-sm text-neutral-700 dark:text-neutral-300">
        {review.comment}
      </blockquote>
      <figcaption className="mt-2.5 flex items-center gap-2">
        {review.overall_rating !== null ? (
          <StarRating value={review.overall_rating} size="sm" />
        ) : null}
        <span className="truncate text-xs font-medium text-neutral-500">
          {review.guest_name?.trim() || "Guest"}
        </span>
      </figcaption>
    </figure>
  ));

  return (
    <section
      aria-label="What guests are saying"
      className="border-t border-neutral-200/70 py-8 dark:border-neutral-800/70"
    >
      <h2 className="mb-4 text-center text-xs font-semibold uppercase tracking-wide text-neutral-400">
        What guests are saying
      </h2>

      <div
        className="review-marquee relative overflow-hidden"
        // Mask the hard edges so bubbles fade in and out rather than being
        // sliced off at the viewport.
        style={{
          maskImage:
            "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
        }}
      >
        <div
          className="review-marquee-track flex"
          style={{ "--marquee-duration": `${duration}s` } as CSSProperties}
        >
          {/* Each group carries its own trailing gap (pr-3) and the track adds
              none, so the two groups are exactly equal in width. That is what
              makes translateX(-50%) land on an identical frame — with a gap on
              the track instead, the loop would jump by one gap every pass. */}
          <div className="flex gap-3 pr-3">{bubbles}</div>
          <div aria-hidden className="flex gap-3 pr-3">
            {bubbles}
          </div>
        </div>
      </div>
    </section>
  );
}
