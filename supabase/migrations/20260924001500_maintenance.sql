-- ============================================================================
-- Housekeeping: expire stale unapproved orders and sweep rate-limit rows.
--
-- A guest who placed an order and walked away leaves a 'placed' row that
-- the waiter queue would otherwise show forever. expire_placed_orders()
-- cancels those past their expires_at with an 'expired' event. It is
-- scheduled every ten minutes with pg_cron when that extension is on
-- (Supabase → Database → Extensions → pg_cron); without it, call the
-- function from any scheduler, or rely on the queues already hiding
-- expired rows.
-- ============================================================================

create or replace function public.expire_placed_orders()
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  with expired as (
    update public.orders
       set status = 'cancelled'
     where status = 'placed' and expires_at < now()
    returning id, restaurant_id
  )
  insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
  select id, restaurant_id, null, 'expired', jsonb_build_object('by', 'system')
    from expired;
  get diagnostics n = row_count;

  delete from public.rate_limit_buckets where window_start < now() - interval '1 day';

  return n;
end;
$$;
revoke all on function public.expire_placed_orders() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Replace any earlier schedule of the same name.
    perform cron.unschedule(jobid) from cron.job where jobname = 'fast_menu_expire_placed_orders';
    perform cron.schedule('fast_menu_expire_placed_orders', '*/10 * * * *', 'select public.expire_placed_orders()');
  end if;
exception when undefined_table or undefined_function or insufficient_privilege then
  null;
end;
$$;
