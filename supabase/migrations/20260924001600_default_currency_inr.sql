-- ============================================================================
-- Default new restaurants to INR.
--
-- The product's customers are Indian hotels and restaurants, so USD was the
-- wrong thing to hand a new signup. The baseline now creates the column with
-- this default; that only helps a fresh database, because `create table if
-- not exists` skips a table that already exists — hence this ALTER for
-- databases created before the change.
--
-- Deliberately NOT a backfill: an existing restaurant's prices were entered
-- as amounts in whatever currency it already had. Rewriting the currency code
-- would relabel every price without converting it (a 12.00 dish silently
-- becoming ₹12.00), so owners change theirs in Settings when they mean to.
-- ============================================================================

alter table public.restaurants
  alter column currency set default 'INR';
