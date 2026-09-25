-- ============================================================================
-- Schedule expire_placed_orders() whenever pg_cron is present, not only when
-- it happened to be on while 20260924001500_maintenance.sql ran.
--
-- That file scheduled the job inside a one-shot block guarded by "pg_cron
-- exists". On a fresh Supabase project pg_cron is off, so the block did
-- nothing, the migration was recorded as applied, and enabling the
-- extension afterwards, as its own comment suggested, never created the
-- job. The schedule now lives in a function that can be run at any time:
--
--   select public.schedule_housekeeping();
--
-- and this migration enables pg_cron itself where the role may, reporting
-- with a notice instead of silently skipping when it may not.
-- ============================================================================

create or replace function public.schedule_housekeeping()
returns text language plpgsql security definer set search_path = public as $$
declare
  job bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return 'pg_cron is not enabled: turn it on under Database -> Extensions, then run select public.schedule_housekeeping();';
  end if;
  for job in select jobid from cron.job where jobname = 'fast_menu_expire_placed_orders' loop
    perform cron.unschedule(job);
  end loop;
  perform cron.schedule('fast_menu_expire_placed_orders', '*/10 * * * *',
                        'select public.expire_placed_orders()');
  return 'expire_placed_orders() runs every ten minutes';
end;
$$;

revoke all on function public.schedule_housekeeping() from public, anon, authenticated;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron could not be enabled from this migration (%). Enable it under Database -> Extensions, then run: select public.schedule_housekeeping();', sqlerrm;
  end;
  raise notice '%', public.schedule_housekeeping();
end;
$$;
