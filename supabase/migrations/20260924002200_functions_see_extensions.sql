-- ============================================================================
-- Let search-path-pinned functions find pgcrypto.
--
-- Supabase pre-installs pgcrypto in the "extensions" schema and puts that
-- schema on the database's default search_path. Our security-definer
-- functions pin "set search_path = public" (so a caller cannot swap in a
-- lookalike function), which also hides "extensions": gen_random_bytes() in
-- generate_order_code() and digest() in claim_trial() failed with "function
-- does not exist", so guests could not place an order and owners could not
-- activate a trial. pg_trgm is created by our own migration and so lands in
-- public, which is why similarity() kept working; list_trial_reviews() gets
-- the same path anyway in case pg_trgm was enabled from the dashboard first.
--
-- "extensions" is skipped when it does not exist, so this is harmless on a
-- plain Postgres.
-- ============================================================================

alter function public.generate_order_code(uuid)
  set search_path = public, extensions;

alter function public.claim_trial(uuid, text, text, text, text)
  set search_path = public, extensions;

alter function public.list_trial_reviews()
  set search_path = public, extensions;
