-- ============================================================================
-- Tell the public menu whether to hide the fast_menu footer.
--
-- The menu renders from restaurants_public with the anon key, so it cannot
-- compute the plan itself — the view does not expose plan, plan_expires_at or
-- the trial columns, and it should not: a guest has no business knowing what
-- their restaurant pays. The view publishes the one derived bit the page needs
-- instead, which is also what makes white-labelling enforced rather than a
-- client-side preference.
-- ============================================================================

create or replace view public.restaurants_public as
  select id, name, slug, description, logo_url, currency, default_locale, locales,
         timezone, ordering_enabled, ordering_paused, pause_message,
         table_qr_enabled, kds_enabled, allow_takeaway, google_review_url,
         created_at, updated_at,
         public.restaurant_plan(id) = 'pro' as hide_branding
    from public.restaurants
   where public.restaurant_is_live(id);

grant select on public.restaurants_public to anon, authenticated;
