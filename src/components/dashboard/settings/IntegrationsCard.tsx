"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Loader2 } from "lucide-react";

import type { Restaurant } from "@/types/db";
import { updateIntegrations } from "@/app/dashboard/settings/actions";
import type { ActionResult } from "@/app/dashboard/lib";

export function IntegrationsCard({ restaurant }: { restaurant: Restaurant }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    updateIntegrations,
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="restaurantId" value={restaurant.id} />
      <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold">Google reviews</h2>
        </div>
        <div className="p-5">
          <label
            htmlFor="google_review_url"
            className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300"
          >
            Review link
          </label>
          <input
            id="google_review_url"
            name="google_review_url"
            type="url"
            inputMode="url"
            defaultValue={restaurant.google_review_url ?? ""}
            placeholder="https://g.page/r/…/review"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800"
          />
          <p className="mt-1.5 text-[11px] text-neutral-400">
            Guests see a &quot;Rate us on Google&quot; button after paying and in the
            menu footer. Find yours in Google Business Profile under{" "}
            <span className="font-medium">Get more reviews</span>. Leave empty to
            hide the button.
          </p>
          {restaurant.google_review_url ? (
            <a
              href={restaurant.google_review_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
            >
              <ExternalLink className="h-3 w-3" aria-hidden /> Open the current link
            </a>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-neutral-100 px-5 py-3.5 dark:border-neutral-800">
          {state?.ok && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          {state && !state.ok && <span className="text-xs text-red-600">{state.error}</span>}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save link
          </button>
        </div>
      </section>
    </form>
  );
}
