-- Tests for platform_usage(), from ../migrations/*_platform_usage.sql.
-- Run with ../../scripts/test-sql.sh.

\pset tuples_only on
\pset format unaligned

insert into public.platform_admins (email, role) values ('usage@example.com', 'project_owner')
on conflict (email) do update set role = 'project_owner';

update public.test_auth set email = 'nobody@example.com';
do $$
begin
  perform public.platform_usage();
  raise exception 'FAIL  a stranger could read the usage';
exception when insufficient_privilege then
  raise notice '  PASS  a stranger is refused';
end $$;

update public.platform_admins set role = 'admin' where email = 'usage@example.com';
update public.test_auth set email = 'usage@example.com';
do $$
begin
  perform public.platform_usage();
  raise exception 'FAIL  an admin could read the usage';
exception when insufficient_privilege then
  raise notice '  PASS  an admin is refused; this is owner only';
end $$;

update public.platform_admins set role = 'project_owner' where email = 'usage@example.com';
select public.platform_usage() as u \gset

\echo ''
\echo '=== platform_usage() ==='
select public.assert((:'u'::jsonb ->> 'db_bytes')::bigint > 0, 'the database has a size');
select public.assert(
  (:'u'::jsonb -> 'storage_bytes') = 'null'::jsonb,
  'storage is null where there is no storage schema, never a made-up zero');
select public.assert(
  jsonb_array_length(:'u'::jsonb -> 'tables') between 1 and 10
  and (:'u'::jsonb -> 'tables' -> 0 ->> 'bytes')::bigint >= (:'u'::jsonb -> 'tables' -> 1 ->> 'bytes')::bigint,
  'the biggest tables come first, at most ten');
select public.assert(
  (:'u'::jsonb -> 'counts' ->> 'restaurants')::int = (select count(*) from public.restaurants)
  and (:'u'::jsonb -> 'counts' ->> 'orders_total')::int = (select count(*) from public.orders),
  'counts match the tables');
select public.assert(
  (:'u'::jsonb ->> 'payments_month_paise')::bigint >= 0,
  'this month''s takings are a number');

delete from public.platform_admins where email = 'usage@example.com';
update public.test_auth set email = null;
