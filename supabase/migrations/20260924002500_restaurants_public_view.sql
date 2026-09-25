-- ============================================================================
-- Keep the owner's identity off the public restaurant row.
--
-- restaurants_public_read admitted every role, the anon key in the browser
-- bundle included, to any published row, and RLS filters rows, never
-- columns. *_trial_claims.sql put the OTP-verified mobile number, GSTIN,
-- city and pincode on that row, so anyone could bulk-download the phone
-- and tax registration of every live restaurant, along with its owner id
-- and trial dates.
--
-- Guests now read restaurants_public, a view of the columns a menu needs,
-- limited to published restaurants with a live trial. It runs with its
-- owner's rights (the default for a view), so the WHERE clause is the
-- gate, and the public policy on the base table is dropped: owners and
-- staff keep their own policies on the table, everyone else gets the view.
-- ============================================================================

create or replace view public.restaurants_public as
  select id, name, slug, description, logo_url, currency, default_locale, locales,
         timezone, ordering_enabled, ordering_paused, pause_message,
         table_qr_enabled, kds_enabled, allow_takeaway, google_review_url,
         created_at, updated_at
    from public.restaurants
   where is_published
     and trial_status = 'active'
     and trial_ends_at > now();

grant select on public.restaurants_public to anon, authenticated;

drop policy if exists "restaurants_public_read" on public.restaurants;
