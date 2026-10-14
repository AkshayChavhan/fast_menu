-- ============================================================================
-- What the platform is using, measured from inside the database.
--
-- The hosting and database vendors show their meters in their own
-- dashboards and, for the most part, not through an API. The two numbers
-- that fill up first — database size and image storage — can be measured
-- right here, along with the growth that drives them, so the operator can
-- see "half full, about four months left" on a page they already open.
-- Owner only: it is a map of the whole installation.
-- ============================================================================

create or replace function public.platform_usage()
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  result         jsonb;
  storage_bytes  bigint;
  storage_count  bigint;
  order_bytes    bigint;
  orders_total   bigint;
  orders_30d     bigint;
  month_start    timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if not public.is_project_owner() then
    raise exception 'not the project owner' using errcode = '42501';
  end if;

  -- Image storage lives in the storage schema on Supabase; absent elsewhere.
  if to_regclass('storage.objects') is not null then
    execute $q$select coalesce(sum((metadata ->> 'size')::bigint), 0), count(*)
               from storage.objects where bucket_id = 'menu-images'$q$
      into storage_bytes, storage_count;
  end if;

  -- An order's footprint, so growth can be projected from the order rate.
  select coalesce(sum(pg_total_relation_size(c.oid)), 0) into order_bytes
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('orders', 'order_items', 'order_events', 'table_sessions');
  select count(*), count(*) filter (where created_at > now() - interval '30 days')
    into orders_total, orders_30d
  from public.orders;

  result := jsonb_build_object(
    'generated_at', now(),
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', storage_bytes,
    'storage_objects', storage_count,
    'order_bytes', order_bytes,
    'bytes_per_order', case when orders_total > 0 then order_bytes / orders_total else null end,
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.relname, 'bytes', t.bytes) order by t.bytes desc)
      from (
        select c.relname, pg_total_relation_size(c.oid) as bytes
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'restaurants',     (select count(*) from public.restaurants),
      'published',       (select count(*) from public.restaurants where is_published),
      'live',            (select count(*) from public.restaurants r where public.restaurant_is_live(r.id)),
      'pro',             (select count(*) from public.restaurants r where public.restaurant_plan(r.id) = 'pro'),
      'dishes',          (select count(*) from public.dishes),
      'images',          (select count(*) from public.dishes where image_url is not null),
      'staff',           (select count(*) from public.restaurant_staff where is_active),
      'leads',           (select count(*) from public.leads),
      'orders_total',    orders_total,
      'orders_30d',      orders_30d,
      'orders_month',    (select count(*) from public.orders where created_at >= month_start)
    ),
    'payments_month_paise', (
      select coalesce(sum(amount_paise), 0) from public.payments
      where status = 'paid' and coalesce(paid_at, created_at) >= month_start
    )
  );
  return result;
end;
$$;

revoke all on function public.platform_usage() from public, anon;
grant execute on function public.platform_usage() to authenticated;
