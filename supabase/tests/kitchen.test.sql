-- Tests for set_item_kds_status() and set_order_kds_status() from
-- ../migrations/. Run with ../../scripts/test-sql.sh.

\pset tuples_only on
\pset format unaligned

\set REST  'cece0000-0000-0000-0000-000000000001'
\set OWNER 'cece1111-1111-1111-1111-111111111111'
\set COOK  'cece2222-2222-2222-2222-222222222222'
\set CHAI  'cfcf0000-0000-0000-0000-000000000011'
\set DOSA  'cfcf0000-0000-0000-0000-000000000012'
\set T1    'd0d00000-0000-0000-0000-000000000001'

\echo ''
\echo '=== setup: kitchen on, one approved order with two lines ==='
update public.test_flags set owns = true;
update public.test_auth set uid = :'COOK';
insert into public.restaurants (id, owner_id, name, slug, is_published, trial_status, currency, ordering_enabled, kds_enabled)
values (:'REST', :'OWNER', 'Tiffin Room', 'tiffin', true, 'active', 'INR', true, true);
insert into public.dishes (id, restaurant_id, name, price_cents) values
  (:'CHAI', :'REST', 'Chai', 4000), (:'DOSA', :'REST', 'Dosa', 9000);
insert into public.tables (id, restaurant_id, label, qr_token) values (:'T1', :'REST', 'Table 1', 'tif-1');

create temp table k1 as
select public.staff_create_order('cece0000-0000-0000-0000-000000000001',
  array['d0d00000-0000-0000-0000-000000000001']::uuid[], 'dine_in', null, null,
  '[{"dish_id": "cfcf0000-0000-0000-0000-000000000011", "quantity": 1},
    {"dish_id": "cfcf0000-0000-0000-0000-000000000012", "quantity": 1}]'::jsonb) as res;

select public.assert(
  (select bool_and(kds_status = 'queued') from public.order_items where order_id = (select (res ->> 'id')::uuid from k1)),
  'items on a new approved order start queued');

\echo ''
\echo '=== an item moves forward and the ticket reports readiness ==='
create temp table chai_item as
select id from public.order_items where order_id = (select (res ->> 'id')::uuid from k1) and name = 'Chai';
create temp table dosa_item as
select id from public.order_items where order_id = (select (res ->> 'id')::uuid from k1) and name = 'Dosa';

select public.assert(
  (public.set_item_kds_status((select id from chai_item), 'preparing') ->> 'order_ready')::boolean = false,
  'queued → preparing; the ticket is not ready yet');
select public.assert(
  (public.set_item_kds_status((select id from chai_item), 'ready') ->> 'order_ready')::boolean = false,
  'preparing → ready; the other line is still queued');
select public.assert(
  (public.set_item_kds_status((select id from dosa_item), 'ready') ->> 'order_ready')::boolean = true,
  'once every line is ready the ticket reports ready');
select public.assert(
  (select count(*) from public.order_events where kind = 'kds' and order_id = (select (res ->> 'id')::uuid from k1)) = 3,
  'each move is logged');

\echo ''
\echo '=== transitions only go forward, except ready → preparing ==='
do $$
begin
  perform public.set_item_kds_status((select id from chai_item), 'queued');
  raise exception 'FAIL  queued is not a target state';
exception when invalid_parameter_value then
  raise notice '  PASS  an item cannot be sent back to queued';
end $$;
select public.set_item_kds_status((select id from chai_item), 'preparing');
select public.assert(
  (select kds_status from public.order_items where id = (select id from chai_item)) = 'preparing',
  'a mistaken ready can go back to preparing');
select public.set_item_kds_status((select id from chai_item), 'served');
do $$
begin
  perform public.set_item_kds_status((select id from chai_item), 'ready');
  raise exception 'FAIL  served is terminal';
exception when invalid_parameter_value then
  raise notice '  PASS  a served item stays served';
end $$;

\echo ''
\echo '=== bumping a whole ticket ==='
create temp table k2 as
select public.staff_create_order('cece0000-0000-0000-0000-000000000001',
  array['d0d00000-0000-0000-0000-000000000001']::uuid[], 'dine_in', null, null,
  '[{"dish_id": "cfcf0000-0000-0000-0000-000000000011", "quantity": 2},
    {"dish_id": "cfcf0000-0000-0000-0000-000000000012", "quantity": 1}]'::jsonb) as res;
select public.assert(
  public.set_order_kds_status((select (res ->> 'id')::uuid from k2), 'preparing') = '{"items": 2}'::jsonb,
  'both queued lines move to preparing');
update public.order_items set kds_status = 'served'
 where order_id = (select (res ->> 'id')::uuid from k2) and name = 'Chai';
select public.assert(
  public.set_order_kds_status((select (res ->> 'id')::uuid from k2), 'ready') = '{"items": 1}'::jsonb,
  'a line already served is left alone');

\echo ''
\echo '=== guards ==='
update public.restaurants set kds_enabled = false where id = :'REST';
do $$
begin
  perform public.set_order_kds_status((select (res ->> 'id')::uuid from k2), 'served');
  raise exception 'FAIL  a switched-off kitchen should refuse';
exception when raise_exception then
  raise notice '  PASS  nothing moves while the kitchen screen is off';
end $$;
update public.restaurants set kds_enabled = true where id = :'REST';
update public.orders set status = 'settled' where id = (select (res ->> 'id')::uuid from k2);
do $$
begin
  perform public.set_order_kds_status((select (res ->> 'id')::uuid from k2), 'served');
  raise exception 'FAIL  a settled order should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  only approved orders move through the kitchen';
end $$;
update public.test_flags set owns = false;
do $$
begin
  perform public.set_item_kds_status((select id from dosa_item), 'served');
  raise exception 'FAIL  a user without a kitchen role should be refused';
exception when insufficient_privilege then
  raise notice '  PASS  a user without a kitchen role is refused';
end $$;
update public.test_flags set owns = true;

delete from public.restaurants where id = :'REST';

\echo ''
\echo 'ALL KITCHEN ASSERTIONS PASSED'
