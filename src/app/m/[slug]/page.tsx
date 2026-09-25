import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Armchair, PauseCircle, UtensilsCrossed } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { localeDir } from "@/lib/utils";
import type { Restaurant, Review, ReviewForm } from "@/types/db";
import { normalizeRatings } from "@/lib/reviews";
import { buildMenuView, loadMenuData, type MenuData } from "@/lib/menu-view";
import { MenuHeader } from "@/components/menu/MenuHeader";
import { MenuHero } from "@/components/menu/MenuHero";
import { MenuBrowser } from "@/components/menu/MenuBrowser";
import { FloatingReviews } from "@/components/menu/FloatingReviews";
import { DocumentLocale } from "@/components/menu/DocumentLocale";
import { CartProvider } from "@/components/ordering/CartProvider";
import { CartBar } from "@/components/ordering/CartBar";
import { ServiceButtons } from "@/components/ordering/ServiceButtons";
import type { OrderingInfo } from "@/components/menu/types";

// Public menus change when the owner edits/publishes; keep them fresh but cheap.
export const revalidate = 60;

// 86'd dishes are hidden by default. Flip to false to show them dimmed.
const HIDE_UNAVAILABLE = true;

type LoadedMenu = MenuData & {
  restaurant: Restaurant;
  /** Approved reviews with something to say, for the floating strip. */
  reviews: Review[];
};

// Only comments make sense as "floating words", and only so many fit before
// the loop gets tediously long.
const MAX_FLOATING_REVIEWS = 20;

// ---------------------------------------------------------------------------
// Data loading — SERVER anon client. RLS returns the restaurant (and its child
// rows) only when is_published = true, so an unpublished slug reads as absent.
// ---------------------------------------------------------------------------
async function loadMenu(slug: string): Promise<LoadedMenu | null> {
  const supabase = await createClient();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Restaurant>();

  if (!restaurant) return null;

  const [menu, formRes, reviewsRes] = await Promise.all([
    loadMenuData(supabase, restaurant.id),
    supabase
      .from("review_forms")
      .select("show_on_menu")
      .eq("restaurant_id", restaurant.id)
      .maybeSingle<Pick<ReviewForm, "show_on_menu">>(),
    // RLS already limits this to approved reviews on published restaurants.
    supabase
      .from("reviews")
      .select("*")
      .eq("restaurant_id", restaurant.id)
      .not("comment", "is", null)
      .order("created_at", { ascending: false })
      .limit(MAX_FLOATING_REVIEWS),
  ]);

  // No form row yet means the feature is on by default (see DEFAULT_REVIEW_SETTINGS).
  const showOnMenu = formRes.data?.show_on_menu ?? true;

  const reviews = showOnMenu
    ? ((reviewsRes.data as Review[] | null) ?? [])
        .map((r) => ({ ...r, ratings: normalizeRatings(r.ratings) }))
        // A comment of only whitespace would render as an empty bubble.
        .filter((r) => (r.comment ?? "").trim().length > 0)
    : [];

  return { restaurant, ...menu, reviews };
}

// The table behind a per-table QR code (?t=<token>). Only active tables on a
// published menu are readable, so a retired code reads as no table.
async function resolveTable(
  slug: string,
  token: string | undefined,
): Promise<{ label: string; token: string } | null> {
  if (!token) return null;
  const supabase = await createClient();
  // Guests may resolve one token, never list a restaurant's tables.
  const { data } = await supabase.rpc("resolve_table_token", { p_slug: slug, p_token: token });
  const table = data as { id: string; label: string; qr_token: string } | null;
  return table ? { label: table.label, token: table.qr_token } : null;
}

// Resolve the active locale from ?lang=, constrained to the restaurant's
// offered locales, falling back to its default_locale.
function resolveLocale(
  restaurant: Restaurant,
  requested: string | undefined,
): string {
  if (requested && restaurant.locales.includes(requested)) return requested;
  return restaurant.default_locale;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const menu = await loadMenu(slug);

  if (!menu) {
    return {
      title: "Menu not found",
      robots: { index: false, follow: false },
    };
  }

  const { restaurant } = menu;
  const locale = restaurant.default_locale;
  const title = restaurant.name;
  const description =
    restaurant.description ??
    `View the menu at ${restaurant.name}. Browse dishes, allergens & more.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      locale,
      images: restaurant.logo_url ? [{ url: restaurant.logo_url }] : undefined,
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: restaurant.logo_url ? [restaurant.logo_url] : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function PublicMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string; t?: string }>;
}) {
  const { slug } = await params;
  const { lang, t } = await searchParams;

  const menu = await loadMenu(slug);
  if (!menu) notFound();

  const { restaurant } = menu;
  const locale = resolveLocale(restaurant, lang);

  const table = restaurant.ordering_enabled ? await resolveTable(restaurant.slug, t) : null;
  const ordering: OrderingInfo | null = restaurant.ordering_enabled
    ? {
        enabled: true,
        paused: restaurant.ordering_paused,
        pauseMessage: restaurant.pause_message,
        allowTakeaway: restaurant.allow_takeaway,
        slug: restaurant.slug,
        currency: restaurant.currency,
        locale,
        table,
      }
    : null;

  const name = restaurant.name;
  const description = restaurant.description;

  const { categories, anyDishes } = buildMenuView(restaurant, menu, locale);
  const dir = localeDir(locale);

  return (
    // `dir` is repeated on the wrapper rather than left to DocumentLocale
    // alone: it keeps the menu correct when the inline script is blocked (a
    // strict CSP) and makes the direction part of the server-rendered HTML.
    <div
      lang={locale}
      dir={dir}
      className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
    >
      <DocumentLocale locale={locale} dir={dir} />

      <MenuHeader
        name={name}
        logoUrl={restaurant.logo_url}
        locales={restaurant.locales}
        activeLocale={locale}
      />

      <MenuHero name={name} description={description} logoUrl={restaurant.logo_url} />

      {ordering?.paused ? (
        <div className="mx-auto max-w-5xl px-4 pt-4">
          <p className="flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">Ordering is paused.</span>{" "}
              {ordering.pauseMessage ?? "You can still browse; please ask a member of staff to order."}
            </span>
          </p>
        </div>
      ) : null}

      {ordering?.table ? (
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 pt-4">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
            <Armchair className="h-3.5 w-3.5" aria-hidden />
            You&apos;re at {ordering.table.label}
          </p>
          <ServiceButtons slug={restaurant.slug} tableToken={ordering.table.token} />
        </div>
      ) : null}

      {anyDishes ? (
        ordering ? (
          <CartProvider slug={restaurant.slug}>
            <div className="pb-24">
              <MenuBrowser
                categories={categories}
                hideUnavailable={HIDE_UNAVAILABLE}
                ordering={ordering}
              />
            </div>
            <CartBar
              slug={restaurant.slug}
              currency={restaurant.currency}
              locale={locale}
              tableToken={ordering.table?.token ?? null}
            />
          </CartProvider>
        ) : (
          <MenuBrowser categories={categories} hideUnavailable={HIDE_UNAVAILABLE} />
        )
      ) : (
        <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-950/50">
            <UtensilsCrossed className="h-8 w-8" aria-hidden />
          </div>
          <h2 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">
            The menu is being prepared
          </h2>
          <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
            {name} hasn’t added any dishes yet. Please check back soon!
          </p>
        </div>
      )}

      <FloatingReviews reviews={menu.reviews} />

      <footer className="border-t border-neutral-200/70 py-8 text-center dark:border-neutral-800/70">
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          {name} · Digital menu powered by{" "}
          <span translate="no" className="font-semibold text-brand-500">
            fast_menu
          </span>
        </p>
      </footer>
    </div>
  );
}
