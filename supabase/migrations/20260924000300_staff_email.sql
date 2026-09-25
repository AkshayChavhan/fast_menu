-- ============================================================================
-- Keep each staff member's login email on their staff row.
--
-- Emails live in auth.users, which only the service role can read. The
-- roster page would otherwise need one Admin API call per row just to show
-- who is who. Staff emails are set by the admin who creates the account and
-- there is no self-service way to change them, so a copy here stays correct.
-- ============================================================================

alter table public.restaurant_staff
  add column if not exists email text;
