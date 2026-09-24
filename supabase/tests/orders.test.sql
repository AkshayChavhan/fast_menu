-- Tests for the guest-side ordering functions from ../migrations/:
-- place_order(), get_order_by_code(), cancel_order_by_code(),
-- create_service_request(), check_rate_limit() and the total triggers.
-- Run with ../../scripts/test-sql.sh.

\pset tuples_only on
\pset format unaligned

\set REST   'cccccccc-0000-0000-0000-000000000001'
\set OTHER  'cccccccc-0000-0000-0000-000000000002'
\set OWNER  'cccccccc-1111-1111-1111-111111111111'
\set CAT    'dddddddd-0000-0000-0000-000000000001'
\set PANEER 'dddddddd-0000-0000-0000-000000000011'
\set CHAI   'dddddddd-0000-0000-0000-000000000012'
\set SOLD   'dddddddd-0000-0000-0000-000000000013'
\set FOREIGN 'dddddddd-0000-0000-0000-000000000099'
\set G_SIZE 'eeeeeeee-0000-0000-0000-000000000001'
\set G_EXTRA 'eeeeeeee-0000-0000-0000-000000000002'
\set O_HALF 'ffffffff-0000-0000-0000-000000000001'
\set O_FULL 'ffffffff-0000-0000-0000-000000000002'
\set O_CHUT 'ffffffff-0000-0000-0000-000000000003'
\set O_CHEESE 'ffffffff-0000-0000-0000-000000000004'
\set O_OFF  'ffffffff-0000-0000-0000-000000000005'
\set TABLE5 '99999999-0000-0000-0000-000000000005'

-- Triggers under test.
create trigger order_items_recalc
  after insert or update or delete on public.order_items
  for each row execute function public.order_items_recalc();
create trigger orders_recalc_session
  after insert or update of status, subtotal_cents, session_id or delete on public.orders
  for each row execute function public.orders_recalc_session();

\echo ''
\echo '=== setup: a published restaurant with ordering on ==='
insert into public.restaurants (id, owner_id, name, slug, is_published, trial_status, currency, ordering_enabled, allow_takeaway)
values (:'REST', :'OWNER', 'Chai Point', 'chai-orders', true, 'active', 'INR', true, false);
insert into public.restaurants (id, owner_id, name, slug, is_published, trial_status, currency, ordering_enabled)
values (:'OTHER', :'OWNER', 'Elsewhere', 'elsewhere', true, 'active', 'INR', true);
insert into public.categories (id, restaurant_id, name) values (:'CAT', :'REST', 'All day');
insert into public.dishes (id, restaurant_id, category_id, name, price_cents, is_available) values
  (:'PANEER', :'REST', :'CAT', 'Paneer Tikka', 30000, true),
  (:'CHAI',   :'REST', :'CAT', 'Chai', 4000, true),
  (:'SOLD',   :'REST', :'CAT', 'Sold out thing', 1000, false),
  (:'FOREIGN', :'OTHER', null, 'Not ours', 500, true);
insert into public.modifier_groups (id, restaurant_id, dish_id, name, kind, min_select, max_select) values
  (:'G_SIZE',  :'REST', :'PANEER', 'Portion', 'variant', 1, 1),
  (:'G_EXTRA', :'REST', :'PANEER', 'Extras',  'addon',   0, 1);
insert into public.modifier_options (id, restaurant_id, group_id, name, price_cents, is_available, is_default) values
  (:'O_HALF',   :'REST', :'G_SIZE',  'Half', 18000, true, true),
  (:'O_FULL',   :'REST', :'G_SIZE',  'Full', 30000, true, false),
  (:'O_CHUT',   :'REST', :'G_EXTRA', 'Extra chutney', 2000, true, false),
  (:'O_CHEESE', :'REST', :'G_EXTRA', 'Cheese', 4000, true, false),
  (:'O_OFF',    :'REST', :'G_EXTRA', 'Truffle', 9000, false, false);
insert into public.tables (id, restaurant_id, label, qr_token) values (:'TABLE5', :'REST', 'Table 5', 'tok5');

\echo ''
\echo '=== a guest places an order with a size and an add-on ==='
create temp table t_res as
select public.place_order('chai-orders', 'tok5', 'dine_in', ' Less spicy please ', $j$[
  {"dish_id": "dddddddd-0000-0000-0000-000000000011", "quantity": 2, "note": "extra mint",
   "variant_option_id": "ffffffff-0000-0000-0000-000000000001",
   "addon_option_ids": ["ffffffff-0000-0000-0000-000000000003", "ffffffff-0000-0000-0000-000000000003"]},
  {"dish_id": "dddddddd-0000-0000-0000-000000000012", "quantity": 1}
]$j$::jsonb, 'device-A', 'hi') as res;

select public.assert(
  (select length(res ->> 'code') = 6 and (res ->> 'code') !~ '[0O1I]' from t_res),
  'the code is six characters from the unambiguous alphabet');
select public.assert(
  (select status = 'placed' and source = 'customer' and table_id = '99999999-0000-0000-0000-000000000005'
      and note = 'Less spicy please' and currency = 'INR' and locale = 'hi' and device_key = 'device-A'
   from public.orders where id = (select (res ->> 'id')::uuid from t_res)),
  'the order carries table, note, currency, locale and device');
select public.assert(
  (select unit_price_cents = 18000 + 2000 and quantity = 2 and line_total_cents = 40000
      and variant ->> 'name' = 'Half' and jsonb_array_length(addons) = 1 and note = 'extra mint'
   from public.order_items where name = 'Paneer Tikka'),
  'the line snapshots the variant price plus add-ons, with duplicates collapsed');
select public.assert(
  (select subtotal_cents from public.orders where id = (select (res ->> 'id')::uuid from t_res)) = 44000,
  'the subtotal is rolled up by trigger');
select public.assert(
  (select count(*) from public.order_events where kind = 'placed') = 1,
  'a placed event is recorded');

\echo ''
\echo '=== get_order_by_code ==='
select public.assert(
  (select public.get_order_by_code('chai-orders', lower(' ' || (res ->> 'code') || ' ')) ->> 'table_label' from t_res) = 'Table 5',
  'the guest view resolves the table label and tolerates case and spaces');
select public.assert(
  (select jsonb_array_length(public.get_order_by_code('chai-orders', res ->> 'code') -> 'items') from t_res) = 2,
  'items are included');
select public.assert(public.get_order_by_code('chai-orders', 'ZZZZZZ') is null, 'an unknown code is null');
select public.assert(
  (select public.get_order_by_code('elsewhere', res ->> 'code') from t_res) is null,
  'a code is scoped to its restaurant');

\echo ''
\echo '=== refusals ==='
do $$
declare
  msg text;
  item constant jsonb := '[{"dish_id": "dddddddd-0000-0000-0000-000000000012", "quantity": 1}]'::jsonb;
begin
  -- takeaway not allowed
  begin
    perform public.place_order('chai-orders', null, 'takeaway', null, item, 'd', null);
    raise exception 'FAIL  takeaway should be refused when not allowed';
  exception when invalid_parameter_value then
    raise notice '  PASS  takeaway is refused when the restaurant does not allow it';
  end;

  -- unavailable dish
  begin
    perform public.place_order('chai-orders', null, 'dine_in', null,
      '[{"dish_id": "dddddddd-0000-0000-0000-000000000013", "quantity": 1}]'::jsonb, 'd', null);
    raise exception 'FAIL  an unavailable dish should be refused';
  exception when invalid_parameter_value then
    get stacked diagnostics msg = message_text;
    if msg like '%not available%' then
      raise notice '  PASS  an unavailable dish is refused with its name';
    else
      raise exception 'FAIL  unexpected message: %', msg;
    end if;
  end;

  -- a dish from another restaurant
  begin
    perform public.place_order('chai-orders', null, 'dine_in', null,
      '[{"dish_id": "dddddddd-0000-0000-0000-000000000099", "quantity": 1}]'::jsonb, 'd', null);
    raise exception 'FAIL  a foreign dish should be refused';
  exception when invalid_parameter_value then
    raise notice '  PASS  a dish from another restaurant is refused';
  end;

  -- missing variant
  begin
    perform public.place_order('chai-orders', null, 'dine_in', null,
      '[{"dish_id": "dddddddd-0000-0000-0000-000000000011", "quantity": 1}]'::jsonb, 'd', null);
    raise exception 'FAIL  a sized dish without a size should be refused';
  exception when invalid_parameter_value then
    get stacked diagnostics msg = message_text;
    if msg like 'Choose a size%' then
      raise notice '  PASS  a sized dish needs its size';
    else
      raise exception 'FAIL  unexpected message: %', msg;
    end if;
  end;

  -- unavailable add-on
  begin
    perform public.place_order('chai-orders', null, 'dine_in', null,
      '[{"dish_id": "dddddddd-0000-0000-0000-000000000011", "quantity": 1,
         "variant_option_id": "ffffffff-0000-0000-0000-000000000002",
         "addon_option_ids": ["ffffffff-0000-0000-0000-000000000005"]}]'::jsonb, 'd', null);
    raise exception 'FAIL  an unavailable add-on should be refused';
  exception when invalid_parameter_value then
    raise notice '  PASS  an unavailable add-on is refused';
  end;

  -- too many add-ons
  begin
    perform public.place_order('chai-orders', null, 'dine_in', null,
      '[{"dish_id": "dddddddd-0000-0000-0000-000000000011", "quantity": 1,
         "variant_option_id": "ffffffff-0000-0000-0000-000000000002",
         "addon_option_ids": ["ffffffff-0000-0000-0000-000000000003", "ffffffff-0000-0000-0000-000000000004"]}]'::jsonb, 'd', null);
    raise exception 'FAIL  exceeding max add-ons should be refused';
  exception when invalid_parameter_value then
    get stacked diagnostics msg = message_text;
    if msg like 'Pick at most 1%' then
      raise notice '  PASS  the add-on maximum is enforced';
    else
      raise exception 'FAIL  unexpected message: %', msg;
    end if;
  end;

  -- bad quantity, empty order
  begin
    perform public.place_order('chai-orders', null, 'dine_in', null,
      '[{"dish_id": "dddddddd-0000-0000-0000-000000000012", "quantity": 0}]'::jsonb, 'd', null);
    raise exception 'FAIL  quantity 0 should be refused';
  exception when invalid_parameter_value then
    raise notice '  PASS  quantity must be at least one';
  end;
  begin
    perform public.place_order('chai-orders', null, 'dine_in', null, '[]'::jsonb, 'd', null);
    raise exception 'FAIL  an empty order should be refused';
  exception when invalid_parameter_value then
    raise notice '  PASS  an empty order is refused';
  end;

  -- paused, disabled, unpublished
  update public.restaurants set ordering_paused = true, pause_message = 'Back at 7 pm' where slug = 'chai-orders';
  begin
    perform public.place_order('chai-orders', null, 'dine_in', null, item, 'd', null);
    raise exception 'FAIL  a paused restaurant should refuse';
  exception when raise_exception then
    get stacked diagnostics msg = message_text;
    if msg = 'Back at 7 pm' then
      raise notice '  PASS  a paused restaurant answers with its own message';
    else
      raise exception 'FAIL  unexpected message: %', msg;
    end if;
  end;
  update public.restaurants set ordering_paused = false, ordering_enabled = false where slug = 'chai-orders';
  begin
    perform public.place_order('chai-orders', null, 'dine_in', null, item, 'd', null);
    raise exception 'FAIL  ordering off should refuse';
  exception when raise_exception then
    raise notice '  PASS  a restaurant with ordering off refuses';
  end;
  update public.restaurants set ordering_enabled = true, is_published = false where slug = 'chai-orders';
  begin
    perform public.place_order('chai-orders', null, 'dine_in', null, item, 'd', null);
    raise exception 'FAIL  unpublished should refuse';
  exception when raise_exception then
    raise notice '  PASS  an unpublished restaurant refuses';
  end;
  update public.restaurants set is_published = true where slug = 'chai-orders';
end $$;

select public.assert(
  (select count(*) from public.orders where restaurant_id = :'REST') = 1,
  'refused orders leave no rows behind');

\echo ''
\echo '=== one unapproved order per device ==='
create temp table t_second as
select public.place_order('chai-orders', 'nope', 'dine_in', null,
  '[{"dish_id": "dddddddd-0000-0000-0000-000000000012", "quantity": 3}]'::jsonb, 'device-A', null) as res;
select public.assert(
  (select status from public.orders where id = (select (res ->> 'id')::uuid from t_res)) = 'cancelled',
  'a new order from the same device cancels the previous placed one');
select public.assert(
  (select table_id is null from public.orders where id = (select (res ->> 'id')::uuid from t_second)),
  'an unknown table token leaves the table unset rather than failing');

\echo ''
\echo '=== cancel_order_by_code ==='
select public.assert(
  (select public.cancel_order_by_code('chai-orders', res ->> 'code', 'device-B') from t_second) = false,
  'another device cannot cancel it');
select public.assert(
  (select public.cancel_order_by_code('chai-orders', res ->> 'code', 'device-A') from t_second) = true,
  'the placing device can cancel it');
select public.assert(
  (select status from public.orders where id = (select (res ->> 'id')::uuid from t_second)) = 'cancelled'
  and (select count(*) from public.order_events where kind = 'cancelled' and actor_id is null) = 1,
  'the order is cancelled with a guest event');
select public.assert(
  (select public.cancel_order_by_code('chai-orders', res ->> 'code', 'device-A') from t_second) = false,
  'cancelling twice is a no-op');

\echo ''
\echo '=== expiry hides stale placed orders ==='
create temp table t_third as
select public.place_order('chai-orders', 'tok5', 'dine_in', null,
  '[{"dish_id": "dddddddd-0000-0000-0000-000000000012", "quantity": 1}]'::jsonb, 'device-C', null) as res;
update public.orders set expires_at = now() - interval '1 minute' where id = (select (res ->> 'id')::uuid from t_third);
select public.assert(
  (select public.get_order_by_code('chai-orders', res ->> 'code') from t_third) is null,
  'an expired unapproved order reads as gone');

\echo ''
\echo '=== session totals follow approved orders ==='
insert into public.table_sessions (id, restaurant_id) values ('55555555-0000-0000-0000-000000000001', :'REST');
update public.orders set status = 'approved', session_id = '55555555-0000-0000-0000-000000000001'
 where id = (select (res ->> 'id')::uuid from t_third);
select public.assert(
  (select total_cents from public.table_sessions where id = '55555555-0000-0000-0000-000000000001') = 4000,
  'approving into a session adds the order to its total');
update public.orders set status = 'cancelled' where id = (select (res ->> 'id')::uuid from t_third);
select public.assert(
  (select total_cents from public.table_sessions where id = '55555555-0000-0000-0000-000000000001') = 0,
  'cancelling removes it again');

\echo ''
\echo '=== service requests ==='
insert into public.table_session_tables (session_id, table_id) values ('55555555-0000-0000-0000-000000000001', :'TABLE5');
create temp table t_req as
select public.create_service_request('chai-orders', 'tok5', 'request_bill', 'device-A') as res;
select public.assert(
  (select (res ->> 'existing')::boolean = false from t_req)
  and (select count(*) from public.service_requests where kind = 'request_bill' and status = 'open') = 1,
  'a bill request is created');
select public.assert(
  (select status = 'bill_requested' and bill_requested_at is not null
   from public.table_sessions where id = '55555555-0000-0000-0000-000000000001'),
  'asking for the bill flags the table''s open session');
select public.assert(
  (public.create_service_request('chai-orders', 'tok5', 'request_bill', 'device-A') ->> 'existing')::boolean = true
  and (select count(*) from public.service_requests where kind = 'request_bill') = 1,
  'a repeat within the window returns the existing request');
do $$
begin
  perform public.create_service_request('chai-orders', 'bad-token', 'call_waiter', 'd');
  raise exception 'FAIL  an unknown table should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  a request needs a valid table code';
end $$;

\echo ''
\echo '=== check_rate_limit ==='
select public.assert(
  public.check_rate_limit('ip:test', 2, interval '10 minutes') = true
  and public.check_rate_limit('ip:test', 2, interval '10 minutes') = true
  and public.check_rate_limit('ip:test', 2, interval '10 minutes') = false,
  'the third call in a window is refused');
update public.rate_limit_buckets set window_start = now() - interval '11 minutes' where key = 'ip:test';
select public.assert(
  public.check_rate_limit('ip:test', 2, interval '10 minutes') = true,
  'a new window starts fresh');
select public.assert(
  public.check_rate_limit('', 2, interval '10 minutes') = false,
  'an empty key is always refused');

-- Leave nothing behind for later test files.
delete from public.restaurants where id in (:'REST', :'OTHER');

\echo ''
\echo 'ALL ORDER ASSERTIONS PASSED'
