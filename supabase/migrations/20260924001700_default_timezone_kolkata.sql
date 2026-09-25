-- ============================================================================
-- Default new restaurants to Asia/Kolkata.
--
-- Companion to the currency change: the customers are Indian hotels, so UTC
-- was the wrong starting point for the zone that schedules, specials and
-- reports are evaluated in. 20260924000100 now creates the column with this
-- default, which covers any database that has not run it yet; this ALTER
-- covers one that already has, since `add column if not exists` skips a
-- column that is already there.
--
-- Existing rows are left alone. A restaurant that has deliberately set its
-- own zone must keep it, and one still sitting on the old 'UTC' default is
-- changed by its owner in Settings — silently moving a live menu's opening
-- hours by five and a half hours is not something to do behind their back.
-- ============================================================================

alter table public.restaurants
  alter column timezone set default 'Asia/Kolkata';
