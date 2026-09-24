-- Tests for the staff-side ordering functions from ../migrations/:
-- approve_order(), reject_order(), staff_cancel_order(), staff_create_order(),
-- staff_set_order_items(), staff_move_order(), open_table_session(),
-- clear_table_session(), resolve_service_request().
-- Run with ../../scripts/test-sql.sh.

\pset tuples_only on
\pset format unaligned

\set REST   'abababab-0000-0000-0000-000000000001'
\set OWNER  'abababab-1111-1111-1111-111111111111'
\set WAITER 'abababab-2222-2222-2222-222222222222'
\set CAT    'acacacac-0000-0000-0000-000000000001'
\set CHAI   'acacacac-0000-0000-0000-000000000011'
\set DOSA   'acacacac-0000-0000-0000-000000000012'
\set T1     'adadadad-0000-0000-0000-000000000001'
\set T2     'adadadad-0000-0000-0000-000000000002'
\set T3     'adadadad-0000-0000-0000-000000000003'

\echo ''
\echo '=== setup ==='
update public.test_flags set owns = true;
update public.test_auth set uid = :'WAITER';
insert into public.restaurants (id, owner_id, name, slug, is_published, trial_status, currency, ordering_enabled, allow_takeaway, kds_enabled)
values (:'REST', :'OWNER', 'Dosa Corner', 'dosa-corner', true, 'active', 'INR', true, true, true);
insert into public.categories (id, restaurant_id, name) values (:'CAT', :'REST', 'All day');
insert into public.dishes (id, restaurant_id, category_id, name, price_cents) values
  (:'CHAI', :'REST', :'CAT', 'Chai', 4000),
  (:'DOSA', :'REST', :'CAT', 'Masala Dosa', 12000);
insert into public.tables (id, restaurant_id, label, qr_token) values
  (:'T1', :'REST', 'Table 1', 'tok-1'),
  (:'T2', :'REST', 'Table 2', 'tok-2'),
  (:'T3', :'REST', 'Table 3', 'tok-3');

-- A guest order to approve.
create temp table g1 as
select public.place_order('dosa-corner', 'tok-1', 'dine_in', null,
  '[{"dish_id": "acacacac-0000-0000-0000-000000000011", "quantity": 2}]'::jsonb, 'guest-1', null) as res;

\echo ''
\echo '=== approve opens a session for the table and queues the kitchen ==='
create temp table a1 as
select public.approve_order((select (res ->> 'id')::uuid from g1), array['adadadad-0000-0000-0000-000000000001']::uuid[], null, null) as res;
select public.assert(
  (select status = 'approved' and approved_by = 'abababab-2222-2222-2222-222222222222' and approved_at is not null
      and table_id = 'adadadad-0000-0000-0000-000000000001' and session_id = (select (res ->> 'session_id')::uuid from a1)
   from public.orders where id = (select (res ->> 'id')::uuid from g1)),
  'the order is approved, stamped and attached to a session');
select public.assert(
  (select status = 'open' and total_cents = 8000 from public.table_sessions where id = (select (res ->> 'session_id')::uuid from a1)),
  'the session is open with the order total');
select public.assert(
  (select count(*) from public.table_session_tables where session_id = (select (res ->> 'session_id')::uuid from a1)) = 1,
  'the table is attached to the session');
select public.assert(
  (select bool_and(kds_status = 'queued') from public.order_items where order_id = (select (res ->> 'id')::uuid from g1)),
  'with the kitchen screen on, items are queued');
select public.assert(
  (select count(*) from public.order_events where order_id = (select (res ->> 'id')::uuid from g1) and kind = 'approved') = 1,
  'an approved event is recorded');
do $$
begin
  perform public.approve_order((select (res ->> 'id')::uuid from g1), array['adadadad-0000-0000-0000-000000000001']::uuid[], null, null);
  raise exception 'FAIL  approving twice should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  an already approved order cannot be approved again';
end $$;

\echo ''
\echo '=== a second order for the same table joins the open session ==='
create temp table g2 as
select public.place_order('dosa-corner', 'tok-1', 'dine_in', null,
  '[{"dish_id": "acacacac-0000-0000-0000-000000000012", "quantity": 1}]'::jsonb, 'guest-1b', null) as res;
select public.assert(
  (public.approve_order((select (res ->> 'id')::uuid from g2), array['adadadad-0000-0000-0000-000000000001']::uuid[], null, null) ->> 'session_id')::uuid
    = (select (res ->> 'session_id')::uuid from a1),
  'the same session is reused');
select public.assert(
  (select total_cents from public.table_sessions where id = (select (res ->> 'session_id')::uuid from a1)) = 20000,
  'the session total now covers both orders');

\echo ''
\echo '=== joined tables ==='
create temp table g3 as
select public.place_order('dosa-corner', null, 'dine_in', null,
  '[{"dish_id": "acacacac-0000-0000-0000-000000000011", "quantity": 1}]'::jsonb, 'guest-3', null) as res;
select public.assert(
  (public.approve_order((select (res ->> 'id')::uuid from g3),
      array['adadadad-0000-0000-0000-000000000001', 'adadadad-0000-0000-0000-000000000002']::uuid[], null, null) ->> 'session_id')::uuid
    = (select (res ->> 'session_id')::uuid from a1),
  'approving onto table 1 + 2 joins table 2 into table 1''s session');
select public.assert(
  (select count(*) from public.table_session_tables where session_id = (select (res ->> 'session_id')::uuid from a1)) = 2,
  'both tables are now on the session');

\echo ''
\echo '=== validation and roles ==='
create temp table g4 as
select public.place_order('dosa-corner', null, 'dine_in', null,
  '[{"dish_id": "acacacac-0000-0000-0000-000000000011", "quantity": 1}]'::jsonb, 'guest-4', null) as res;
do $$
begin
  perform public.approve_order((select (res ->> 'id')::uuid from g4), array[]::uuid[], 'dine_in', null);
  raise exception 'FAIL  dine-in without a table should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  a dine-in approval needs a table';
end $$;
do $$
begin
  perform public.approve_order((select (res ->> 'id')::uuid from g4), array['00000000-0000-0000-0000-000000000000']::uuid[], null, null);
  raise exception 'FAIL  an unknown table should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  an unknown table is refused';
end $$;
update public.test_flags set owns = false;
do $$
begin
  perform public.approve_order((select (res ->> 'id')::uuid from g4), array['adadadad-0000-0000-0000-000000000003']::uuid[], null, null);
  raise exception 'FAIL  a user without a serving role should be refused';
exception when insufficient_privilege then
  raise notice '  PASS  a user without a serving role is refused';
end $$;
update public.test_flags set owns = true;
select public.assert(
  (select status from public.orders where id = (select (res ->> 'id')::uuid from g4)) = 'placed',
  'refused approvals leave the order untouched');

\echo ''
\echo '=== takeaway gets its own session ==='
create temp table a4 as
select public.approve_order((select (res ->> 'id')::uuid from g4), array[]::uuid[], 'takeaway', 'Ravi') as res;
select public.assert(
  (select service_type = 'takeaway' and guest_label = 'Ravi' and status = 'open'
   from public.table_sessions where id = (select (res ->> 'session_id')::uuid from a4)),
  'a takeaway approval opens a labelled takeaway session');
select public.assert(
  (select table_id is null and service_type = 'takeaway' from public.orders where id = (select (res ->> 'id')::uuid from g4)),
  'the order carries no table');

\echo ''
\echo '=== reject and cancel ==='
create temp table g5 as
select public.place_order('dosa-corner', null, 'dine_in', null,
  '[{"dish_id": "acacacac-0000-0000-0000-000000000011", "quantity": 1}]'::jsonb, 'guest-5', null) as res;
select public.reject_order((select (res ->> 'id')::uuid from g5), '  Kitchen closing  ');
select public.assert(
  (select status = 'rejected' and rejected_reason = 'Kitchen closing' from public.orders where id = (select (res ->> 'id')::uuid from g5)),
  'a placed order can be rejected with a trimmed reason');
do $$
begin
  perform public.reject_order((select (res ->> 'id')::uuid from g1), 'x');
  raise exception 'FAIL  rejecting an approved order should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  an approved order cannot be rejected';
end $$;
select public.staff_cancel_order((select (res ->> 'id')::uuid from g3), 'guests left');
select public.assert(
  (select status from public.orders where id = (select (res ->> 'id')::uuid from g3)) = 'cancelled'
  and (select total_cents from public.table_sessions where id = (select (res ->> 'session_id')::uuid from a1)) = 20000,
  'staff can cancel an approved order and the session total drops it');

\echo ''
\echo '=== a waiter takes an order directly ==='
create temp table w1 as
select public.staff_create_order('abababab-0000-0000-0000-000000000001',
  array['adadadad-0000-0000-0000-000000000003']::uuid[], 'dine_in', null, ' No onion ',
  '[{"dish_id": "acacacac-0000-0000-0000-000000000012", "quantity": 2, "note": "crispy"}]'::jsonb) as res;
select public.assert(
  (select status = 'approved' and source = 'waiter' and created_by = 'abababab-2222-2222-2222-222222222222'
      and approved_by = 'abababab-2222-2222-2222-222222222222' and note = 'No onion'
      and table_id = 'adadadad-0000-0000-0000-000000000003' and subtotal_cents = 24000
   from public.orders where id = (select (res ->> 'id')::uuid from w1)),
  'the order is created approved, by and for the waiter, with its total');
select public.assert(
  (select length(res ->> 'code') from w1) = 6,
  'waiter orders get a code too');
select public.assert(
  (select count(*) from public.order_events where order_id = (select (res ->> 'id')::uuid from w1)) = 2,
  'placed and approved events are both recorded');
do $$
begin
  perform public.staff_create_order('abababab-0000-0000-0000-000000000001', array[]::uuid[], 'dine_in', null, null,
    '[{"dish_id": "acacacac-0000-0000-0000-000000000011", "quantity": 1}]'::jsonb);
  raise exception 'FAIL  a dine-in waiter order needs a table';
exception when invalid_parameter_value then
  raise notice '  PASS  a dine-in waiter order needs a table';
end $$;

\echo ''
\echo '=== editing items replaces the lines and logs before/after ==='
select public.assert(
  public.staff_set_order_items((select (res ->> 'id')::uuid from w1),
    '[{"dish_id": "acacacac-0000-0000-0000-000000000012", "quantity": 1},
      {"dish_id": "acacacac-0000-0000-0000-000000000011", "quantity": 3}]'::jsonb) = '{"items": 2}'::jsonb,
  'the new line count is returned');
select public.assert(
  (select subtotal_cents = 24000 and last_edited_by is not null and last_edited_at is not null
   from public.orders where id = (select (res ->> 'id')::uuid from w1)),
  'the subtotal follows the new lines and the edit is stamped');
select public.assert(
  (select jsonb_array_length(details -> 'before') = 1 and (details ->> 'after_count')::int = 2
   from public.order_events where order_id = (select (res ->> 'id')::uuid from w1) and kind = 'items_changed'),
  'the event holds the previous lines and the new count');
select public.assert(
  (select bool_and(kds_status = 'queued') from public.order_items where order_id = (select (res ->> 'id')::uuid from w1)),
  'new lines on an approved order are queued for the kitchen');
update public.orders set status = 'settled' where id = (select (res ->> 'id')::uuid from w1);
do $$
begin
  perform public.staff_set_order_items((select (res ->> 'id')::uuid from w1), '[{"dish_id": "acacacac-0000-0000-0000-000000000011", "quantity": 1}]'::jsonb);
  raise exception 'FAIL  a settled order should be frozen';
exception when invalid_parameter_value then
  raise notice '  PASS  a settled order cannot be edited';
end $$;
update public.orders set status = 'approved' where id = (select (res ->> 'id')::uuid from w1);

\echo ''
\echo '=== moving an order to another table ==='
create temp table mv as
select public.staff_move_order((select (res ->> 'id')::uuid from w1), array['adadadad-0000-0000-0000-000000000002']::uuid[], null, null) as res;
select public.assert(
  (select (res ->> 'session_id')::uuid from mv) = (select (res ->> 'session_id')::uuid from a1),
  'moving onto table 2 lands on the joined session that already holds it');
select public.assert(
  (select table_id from public.orders where id = (select (res ->> 'id')::uuid from w1)) = 'adadadad-0000-0000-0000-000000000002',
  'the order now points at table 2');
select public.assert(
  (select total_cents from public.table_sessions where id = (select (res ->> 'session_id')::uuid from w1)) = 0,
  'the old session no longer counts it');
select public.assert(
  (select count(*) from public.order_events where order_id = (select (res ->> 'id')::uuid from w1) and kind = 'table_changed') = 1,
  'a table_changed event is recorded');

\echo ''
\echo '=== tables on separate bills cannot be joined blindly ==='
do $$
begin
  perform public.staff_move_order((select (res ->> 'id')::uuid from w1),
    array['adadadad-0000-0000-0000-000000000002', 'adadadad-0000-0000-0000-000000000003']::uuid[], null, null);
  raise exception 'FAIL  joining tables from two open sessions should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  two tables on separate open bills cannot be joined';
end $$;

\echo ''
\echo '=== seating and clearing ==='
-- Table 3 still carries the empty session the moved order left behind;
-- clear it, then seat a walk-in there.
select public.clear_table_session((select (res ->> 'session_id')::uuid from w1));
select public.open_table_session('abababab-0000-0000-0000-000000000001',
  array['adadadad-0000-0000-0000-000000000003']::uuid[], 'walk-in');
select public.assert(
  (select status = 'open' and guest_label = 'walk-in'
   from public.table_sessions s join public.table_session_tables st on st.session_id = s.id
   where st.table_id = 'adadadad-0000-0000-0000-000000000003' and s.status = 'open'),
  'seating a walk-in opens a labelled session');
select public.clear_table_session(
  (select s.id from public.table_sessions s join public.table_session_tables st on st.session_id = s.id
    where st.table_id = 'adadadad-0000-0000-0000-000000000003' and s.status = 'open' limit 1));
select public.assert(
  not exists (select 1 from public.table_sessions s join public.table_session_tables st on st.session_id = s.id
              where st.table_id = 'adadadad-0000-0000-0000-000000000003' and s.status = 'open'),
  'a session with nothing to pay can be cleared');
do $$
begin
  perform public.clear_table_session((select (res ->> 'session_id')::uuid from a1));
  raise exception 'FAIL  a session with approved orders should not be clearable';
exception when invalid_parameter_value then
  raise notice '  PASS  a session with orders to pay cannot be cleared';
end $$;

\echo ''
\echo '=== service requests are resolved by staff ==='
create temp table sr as
select public.create_service_request('dosa-corner', 'tok-1', 'call_waiter', 'guest-1') as res;
select public.resolve_service_request((select (res ->> 'id')::uuid from sr));
select public.assert(
  (select status = 'done' and resolved_by = 'abababab-2222-2222-2222-222222222222' and resolved_at is not null
   from public.service_requests where id = (select (res ->> 'id')::uuid from sr)),
  'a request is marked done with who resolved it');

delete from public.restaurants where id = :'REST';

\echo ''
\echo 'ALL STAFF ORDER ASSERTIONS PASSED'
