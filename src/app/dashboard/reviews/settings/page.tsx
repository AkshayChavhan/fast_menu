import { getActiveContext } from "../../lib";
import { getSiteOrigin } from "@/lib/site";
import { publicReviewPath, settingsFromForm } from "@/lib/reviews";
import { createClient } from "@/lib/supabase/server";
import type { ReviewForm } from "@/types/db";
import { ReviewFormBuilder } from "@/components/dashboard/reviews/ReviewFormBuilder";

export const metadata = {
  title: "Review settings — fast_menu",
};

export default async function ReviewSettingsPage() {
  const { restaurant } = await getActiveContext();
  const supabase = await createClient();
  const origin = await getSiteOrigin();

  // No row until the owner saves for the first time; settingsFromForm() fills
  // in the defaults so the builder always has something to show.
  const { data: form } = await supabase
    .from("review_forms")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .maybeSingle<ReviewForm>();

  const reviewUrl = `${origin}${publicReviewPath(restaurant.slug)}`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Review settings</h1>
        <p className="text-sm text-neutral-500">
          Build the form guests see when they scan your review QR code.
        </p>
      </div>

      <ReviewFormBuilder
        restaurantId={restaurant.id}
        slug={restaurant.slug}
        reviewUrl={reviewUrl}
        isPublished={restaurant.is_published}
        initial={settingsFromForm(form)}
      />
    </div>
  );
}
