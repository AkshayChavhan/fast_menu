-- Tests for settle_session() and reopen_session() from ../migrations/.
-- Run with ../../scripts/test-sql.sh.

\pset tuples_only on
\pset format unaligned

\set REST    'baba0000-0000-0000-0000-000000000001'
\set OWNER   'baba1111-1111-1111-1111-111111111111'
\set CASHIER 'baba2222-2222-2222-2222-222222222222'
\set CHAI    'bcbc0000-0000-0000-0000-000000000011'
\set T1      'bdbd0000-0000-0000-0000-000000000001'

\echo ''
\echo '=== setup: a bill with two approved orders and an open request ==='
update public.test_flags set owns = true;
update public.test_auth set uid = :'CASHIER';
insert into public.restaurants (id, owner_id, name, slug, is_published, trial_status, currency, ordering_enabled)
values (:'REST', :'OWNER', 'Idli House', 'idli-house', true, 'active', 'INR', true);
insert into public.dishes (id, restaurant_id, name, price_cents) values (:'CHAI', :'REST', 'Chai', 4000);
insert into public.tables (id, restaurant_id, label, qr_token) values (:'T1', :'REST', 'Table 1', 'idli-1');

create temp table b1 as
select public.staff_create_order('baba0000-0000-0000-0000-000000000001',
  array['bdbd0000-0000-0000-0000-000000000001']::uuid[], 'dine_in', null, null,
  '[{"dish_id": "bcbc0000-0000-0000-0000-000000000011", "quantity": 2}]'::jsonb) as res;
create temp table b2 as
select public.staff_create_order('baba0000-0000-0000-0000-000000000001',
  array['bdbd0000-0000-0000-0000-000000000001']::uuid[], 'dine_in', null, null,
  '[{"dish_id": "bcbc0000-0000-0000-0000-000000000011", "quantity": 1}]'::jsonb) as res;
select public.create_service_request('idli-house', 'idli-1', 'request_bill', 'dev');

select public.assert(
  (select (res ->> 'session_id')::uuid from b1) = (select (res ->> 'session_id')::uuid from b2),
  'both orders sit on one bill');
select public.assert(
  (select status = 'bill_requested' and total_cents = 12000
   from public.table_sessions where id = (select (res ->> 'session_id')::uuid from b1)),
  'the bill was requested and totals both orders');

\echo ''
\echo '=== settling ==='
create temp table paid as
select public.settle_session((select (res ->> 'session_id')::uuid from b1), ' UPI ') as res;
select public.assert(
  (select (res ->> 'orders')::int = 2 and (res ->> 'total_cents')::int = 12000 from paid),
  'settle reports the orders and the total');
select public.assert(
  (select status = 'closed' and closed_at is not null and closed_by = 'baba2222-2222-2222-2222-222222222222'
      and payment_method = 'UPI'
   from public.table_sessions where id = (select (res ->> 'session_id')::uuid from b1)),
  'the session is closed, stamped, and remembers how it was paid');
select public.assert(
  (select bool_and(status = 'settled') from public.orders where session_id = (select (res ->> 'session_id')::uuid from b1)),
  'every approved order on it is settled');
select public.assert(
  (select count(*) from public.order_events where kind = 'paid'
     and order_id in (select id from public.orders where session_id = (select (res ->> 'session_id')::uuid from b1))) = 2,
  'a paid event is recorded per order');
select public.assert(
  not exists (select 1 from public.service_requests where session_id = (select (res ->> 'session_id')::uuid from b1) and status = 'open'),
  'open requests from the table are cleared');
select public.assert(
  (select total_cents from public.table_sessions where id = (select (res ->> 'session_id')::uuid from b1)) = 12000,
  'the total still counts the settled orders');
do $$
begin
  perform public.settle_session((select (res ->> 'session_id')::uuid from b1), null);
  raise exception 'FAIL  settling twice should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  a settled bill cannot be settled again';
end $$;

\echo ''
\echo '=== a settled order is frozen for the floor ==='
do $$
begin
  perform public.staff_set_order_items((select (res ->> 'id')::uuid from b1), '[{"dish_id": "bcbc0000-0000-0000-0000-000000000011", "quantity": 9}]'::jsonb);
  raise exception 'FAIL  editing a settled order should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  a settled order cannot be edited';
end $$;

\echo ''
\echo '=== reopening ==='
select public.reopen_session((select (res ->> 'session_id')::uuid from b1));
select public.assert(
  (select status = 'open' and closed_at is null and payment_method is null
   from public.table_sessions where id = (select (res ->> 'session_id')::uuid from b1)),
  'the session is open again');
select public.assert(
  (select bool_and(status = 'approved') from public.orders where session_id = (select (res ->> 'session_id')::uuid from b1))
  and (select count(*) from public.order_events where kind = 'reopened') = 2,
  'its orders are approved again with a reopened event each');
do $$
begin
  perform public.reopen_session((select (res ->> 'session_id')::uuid from b1));
  raise exception 'FAIL  reopening an open bill should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  an open bill cannot be reopened';
end $$;

\echo ''
\echo '=== roles ==='
update public.test_flags set owns = false;
do $$
begin
  perform public.settle_session((select (res ->> 'session_id')::uuid from b1), null);
  raise exception 'FAIL  a user without a billing role should be refused';
exception when insufficient_privilege then
  raise notice '  PASS  a user without a billing role cannot settle';
end $$;
update public.test_flags set owns = true;

delete from public.restaurants where id = :'REST';

\echo ''
\echo 'ALL BILLING ASSERTIONS PASSED'
