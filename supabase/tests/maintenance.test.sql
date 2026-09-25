-- Tests for expire_placed_orders() from ../migrations/.
-- Run with ../../scripts/test-sql.sh.

\pset tuples_only on
\pset format unaligned

\set REST  'dada0000-0000-0000-0000-000000000001'
\set OWNER 'dada1111-1111-1111-1111-111111111111'
\set CHAI  'dbdb0000-0000-0000-0000-000000000011'

\echo ''
\echo '=== setup: one stale placed order, one fresh, one approved ==='
update public.test_flags set owns = true;
update public.test_auth set uid = :'OWNER';
insert into public.restaurants (id, owner_id, name, slug, is_published, trial_status, currency, ordering_enabled)
values (:'REST', :'OWNER', 'Late Night', 'late-night', true, 'active', 'INR', true);
insert into public.dishes (id, restaurant_id, name, price_cents) values (:'CHAI', :'REST', 'Chai', 4000);

create temp table stale as
select public.place_order('late-night', null, 'dine_in', null,
  '[{"dish_id": "dbdb0000-0000-0000-0000-000000000011", "quantity": 1}]'::jsonb, 'dev-1', null) as res;
create temp table fresh as
select public.place_order('late-night', null, 'dine_in', null,
  '[{"dish_id": "dbdb0000-0000-0000-0000-000000000011", "quantity": 1}]'::jsonb, 'dev-2', null) as res;
update public.orders set expires_at = now() - interval '1 minute' where id = (select (res ->> 'id')::uuid from stale);
insert into public.rate_limit_buckets (key, window_start, count) values
  ('old', now() - interval '2 days', 3), ('recent', now(), 1);

\echo ''
\echo '=== expiring ==='
select public.assert(public.expire_placed_orders() = 1, 'one stale order is expired');
select public.assert(
  (select status from public.orders where id = (select (res ->> 'id')::uuid from stale)) = 'cancelled'
  and (select status from public.orders where id = (select (res ->> 'id')::uuid from fresh)) = 'placed',
  'the stale order is cancelled and the fresh one is untouched');
select public.assert(
  (select count(*) from public.order_events where kind = 'expired' and order_id = (select (res ->> 'id')::uuid from stale)) = 1,
  'an expired event is recorded');
select public.assert(
  (select array_agg(key order by key) from public.rate_limit_buckets where key in ('old', 'recent')) = array['recent'],
  'rate-limit rows older than a day are swept');
select public.assert(public.expire_placed_orders() = 0, 'a second run finds nothing');

delete from public.restaurants where id = :'REST';
delete from public.rate_limit_buckets where key = 'recent';

\echo ''
\echo 'ALL MAINTENANCE ASSERTIONS PASSED'
