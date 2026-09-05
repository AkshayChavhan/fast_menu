import Link from "next/link";
import { Star, Settings2 } from "lucide-react";

import { getActiveContext } from "../lib";
import { createClient } from "@/lib/supabase/server";
import { normalizeRatings } from "@/lib/reviews";
import type { Review } from "@/types/db";
import { ReviewModerationList } from "@/components/dashboard/reviews/ReviewModerationList";

export const metadata = {
  title: "Reviews — fast_menu",
};

export default async function ReviewsPage() {
  const { restaurant } = await getActiveContext();
  const supabase = await createClient();

  const { data } = await supabase
    .from("reviews")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .order("created_at", { ascending: false })
    .limit(200);

  // `ratings` is jsonb; normalize once here so the client component can trust
  // its shape.
  const reviews: Review[] = ((data as Review[] | null) ?? []).map((r) => ({
    ...r,
    ratings: normalizeRatings(r.ratings),
  }));

  const pending = reviews.filter((r) => r.status === "pending");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reviews</h1>
          <p className="text-sm text-neutral-500">
            {pending.length > 0
              ? `${pending.length} waiting for your approval.`
              : "Everything here has been dealt with."}
          </p>
        </div>
        <Link
          href="/dashboard/reviews/settings"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Review settings
        </Link>
      </div>

      {reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-16 text-center dark:border-neutral-700">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-950/50">
            <Star className="h-6 w-6" aria-hidden />
          </div>
          <h2 className="text-sm font-semibold">No reviews yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-500">
            Print your review QR code and put it on the bill. Submissions land
            here for approval before they appear on your menu.
          </p>
          <Link
            href="/dashboard/qr"
            className="mt-4 inline-block text-xs font-medium text-brand-600 hover:underline"
          >
            Get the review QR code
          </Link>
        </div>
      ) : (
        <ReviewModerationList
          reviews={reviews}
          restaurantId={restaurant.id}
          slug={restaurant.slug}
        />
      )}
    </div>
  );
}
