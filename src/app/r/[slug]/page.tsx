import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { settingsFromForm } from "@/lib/reviews";
import { publicMenuPath } from "@/lib/site";
import type { Restaurant, ReviewForm } from "@/types/db";
import { ReviewSubmitForm } from "@/components/reviews/ReviewSubmitForm";

// The form itself is owner-controlled config that changes rarely; the page is
// otherwise static, so a short revalidate keeps edits visible without making
// every scan hit the database.
export const revalidate = 60;

type LoadedForm = {
  restaurant: Restaurant;
  form: ReviewForm | null;
};

// RLS returns the restaurant only when it's published and the trial is live,
// so an unreachable slug reads as absent here with no extra checks.
async function loadReviewPage(slug: string): Promise<LoadedForm | null> {
  const supabase = await createClient();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Restaurant>();

  if (!restaurant) return null;

  const { data: form } = await supabase
    .from("review_forms")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .maybeSingle<ReviewForm>();

  // A form row that exists but is switched off hides the page entirely.
  if (form && !form.is_enabled) return null;

  return { restaurant, form: form ?? null };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadReviewPage(slug);

  if (!loaded) {
    return { title: "Review page not found", robots: { index: false, follow: false } };
  }

  return {
    title: `Leave a review · ${loaded.restaurant.name}`,
    description: `Tell ${loaded.restaurant.name} how your visit went.`,
    // A feedback form has no business in search results.
    robots: { index: false, follow: false },
  };
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const loaded = await loadReviewPage(slug);
  if (!loaded) notFound();

  const { restaurant, form } = loaded;
  const settings = settingsFromForm(form);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col px-4 py-10">
        <header className="text-center">
          {restaurant.logo_url ? (
            <Image
              src={restaurant.logo_url}
              alt=""
              width={64}
              height={64}
              className="mx-auto h-16 w-16 rounded-full object-cover"
            />
          ) : null}
          <p className="mt-3 text-sm font-medium text-neutral-500">
            {restaurant.name}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {settings.headline}
          </h1>
          {settings.intro ? (
            <p className="mt-2 text-sm text-neutral-500">{settings.intro}</p>
          ) : null}
        </header>

        <main className="mt-8 flex-1">
          <ReviewSubmitForm slug={restaurant.slug} settings={settings} />
        </main>

        <footer className="mt-10 text-center">
          <Link
            href={publicMenuPath(restaurant.slug)}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            View the menu
          </Link>
          <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
            Powered by{" "}
            <span className="font-semibold text-brand-500">fast_menu</span>
          </p>
        </footer>
      </div>
    </div>
  );
}
