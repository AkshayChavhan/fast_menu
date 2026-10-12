-- Tests for restaurant_insights(), from ../migrations/*_restaurant_insights.sql.
-- Run with ../../scripts/test-sql.sh.
--
-- An owner reads these numbers as their takings, so what is pinned down here
-- is what counts as a sale, which day and hour it lands on by the restaurant's
-- own clock, and that nobody outside the restaurant can ask.

\pset tuples_only on
\pset format unaligned

\set R 'c0de0000-0000-0000-0000-000000000001'
\set EMPTY 'c0de0000-0000-0000-0000-000000000002'
\set ODD 'c0de0000-0000-0000-0000-000000000003'
\set OWNER 'c0de0000-0000-0000-0000-0000000000aa'
\set PANEER 'c0de0000-0000-0000-0000-0000000000d1'
\set DAL 'c0de0000-0000-0000-0000-0000000000d2'
\set RAITA 'c0de0000-0000-0000-0000-0000000000d3'
\set NEWDISH 'c0de0000-0000-0000-0000-0000000000d4'
\set OFFDISH 'c0de0000-0000-0000-0000-0000000000d5'

insert into public.restaurants (id, owner_id, name, slug, timezone, is_published, trial_status) values
  (:'R',     :'OWNER', 'Insight Inn', 'insight-inn', 'Asia/Kolkata', true, 'active'),
  (:'EMPTY', :'OWNER', 'Empty Inn',   'empty-inn',   'Asia/Kolkata', true, 'active'),
  (:'ODD',   :'OWNER', 'Odd Zone',    'odd-zone',    'Mars/Olympus', true, 'active');

-- Every timestamp below is built from the restaurant's own calendar, not from
-- now(), so the buckets are the same whatever time the suite runs.
create temp table clock as
  select (now() at time zone 'Asia/Kolkata')::date as today;

-- local(days_ago, 'HH:MI') -> that wall-clock moment in Kolkata, as timestamptz.
create function pg_temp.local(days_ago int, hhmi text) returns timestamptz
language sql as $$
  select ((select today from clock) - days_ago + hhmi::time) at time zone 'Asia/Kolkata'
$$;

insert into public.dishes (id, restaurant_id, name, is_available, created_at) values
  (:'PANEER',  :'R', 'Paneer Tikka',  true,  now() - interval '90 days'),
  (:'DAL',     :'R', 'Dal Makhani',   true,  now() - interval '90 days'),
  -- On the menu the whole time and never ordered.
  (:'RAITA',   :'R', 'Boondi Raita',  true,  now() - interval '90 days'),
  -- Never ordered either, but only a week old.
  (:'NEWDISH', :'R', 'Weekend Thali', true,  now() - interval '7 days'),
  -- Never ordered, and switched off.
  (:'OFFDISH', :'R', 'Mango Lassi',   false, now() - interval '90 days');

insert into public.tables (id, restaurant_id, label, is_active) values
  ('c0de0000-0000-0000-0000-0000000000f1', :'R', 'T1', true),
  ('c0de0000-0000-0000-0000-0000000000f2', :'R', 'T2', true),
  ('c0de0000-0000-0000-0000-0000000000f3', :'R', 'T3', true),
  ('c0de0000-0000-0000-0000-0000000000f4', :'R', 'Old patio', false);

-- Bills. Settled ones are sales on the day they were paid.
insert into public.table_sessions (id, restaurant_id, status, total_cents, opened_at, closed_at) values
  -- 00:30 in Kolkata is still yesterday in UTC; it is today's money.
  ('c0de0000-0000-0000-0000-0000000000b1', :'R', 'closed', 120000, pg_temp.local(1, '23:10'), pg_temp.local(0, '00:30')),
  ('c0de0000-0000-0000-0000-0000000000b2', :'R', 'closed',  80000, pg_temp.local(0, '13:00'), pg_temp.local(0, '13:45')),
  ('c0de0000-0000-0000-0000-0000000000b3', :'R', 'closed',  50000, pg_temp.local(7, '20:00'), pg_temp.local(7, '21:00')),
  -- Outside the thirty days.
  ('c0de0000-0000-0000-0000-0000000000b4', :'R', 'closed', 999900, pg_temp.local(31, '20:00'), pg_temp.local(31, '21:00')),
  -- Still on the floor: two tables joined on one bill, and one asking to pay.
  ('c0de0000-0000-0000-0000-0000000000b5', :'R', 'open',           34000, pg_temp.local(0, '12:00'), null),
  ('c0de0000-0000-0000-0000-0000000000b6', :'R', 'bill_requested', 21000, pg_temp.local(0, '12:10'), null);

insert into public.table_session_tables (session_id, table_id) values
  ('c0de0000-0000-0000-0000-0000000000b5', 'c0de0000-0000-0000-0000-0000000000f1'),
  ('c0de0000-0000-0000-0000-0000000000b5', 'c0de0000-0000-0000-0000-0000000000f2'),
  ('c0de0000-0000-0000-0000-0000000000b6', 'c0de0000-0000-0000-0000-0000000000f3');

insert into public.orders (id, restaurant_id, code, currency, status, source, service_type, created_at) values
  ('c0de0000-0000-0000-0000-0000000000a1', :'R', 'AAAAAA', 'INR', 'settled',   'customer', 'dine_in',  pg_temp.local(0, '13:05')),
  ('c0de0000-0000-0000-0000-0000000000a2', :'R', 'BBBBBB', 'INR', 'approved',  'waiter',   'dine_in',  pg_temp.local(0, '13:40')),
  ('c0de0000-0000-0000-0000-0000000000a3', :'R', 'CCCCCC', 'INR', 'settled',   'customer', 'takeaway', pg_temp.local(1, '20:15')),
  ('c0de0000-0000-0000-0000-0000000000a4', :'R', 'DDDDDD', 'INR', 'settled',   'customer', 'dine_in',  pg_temp.local(7, '20:30')),
  -- Outside the thirty days.
  ('c0de0000-0000-0000-0000-0000000000a5', :'R', 'EEEEEE', 'INR', 'settled',   'customer', 'dine_in',  pg_temp.local(31, '20:30')),
  -- Never accepted by staff.
  ('c0de0000-0000-0000-0000-0000000000a6', :'R', 'FFFFFF', 'INR', 'placed',    'customer', 'dine_in',  pg_temp.local(0, '13:10')),
  ('c0de0000-0000-0000-0000-0000000000a7', :'R', 'GGGGGG', 'INR', 'rejected',  'customer', 'dine_in',  pg_temp.local(0, '13:11')),
  ('c0de0000-0000-0000-0000-0000000000a8', :'R', 'HHHHHH', 'INR', 'cancelled', 'customer', 'dine_in',  pg_temp.local(0, '13:12'));

insert into public.order_items (order_id, restaurant_id, dish_id, name, unit_price_cents, quantity, addons) values
  ('c0de0000-0000-0000-0000-0000000000a1', :'R', :'PANEER', 'Paneer Tikka', 32000, 2,
   '[{"name":"Extra butter","price_cents":2000},{"name":"Extra chutney","price_cents":2000}]'),
  -- Sold under its old name; it is the same dish.
  ('c0de0000-0000-0000-0000-0000000000a2', :'R', :'PANEER', 'Paneer Tikka (old name)', 30000, 1,
   '[{"name":"Extra butter","price_cents":2000}]'),
  ('c0de0000-0000-0000-0000-0000000000a3', :'R', :'DAL', 'Dal Makhani', 24000, 2, '[]'),
  -- The dish behind this line has since been deleted.
  ('c0de0000-0000-0000-0000-0000000000a4', :'R', null, 'Gulab Jamun', 9000, 4, '[]'),
  -- Lines on orders that do not count.
  ('c0de0000-0000-0000-0000-0000000000a5', :'R', :'RAITA', 'Boondi Raita', 9000, 50, '[]'),
  ('c0de0000-0000-0000-0000-0000000000a6', :'R', :'RAITA', 'Boondi Raita', 9000, 50,
   '[{"name":"Extra butter","price_cents":2000}]'),
  ('c0de0000-0000-0000-0000-0000000000a7', :'R', :'DAL', 'Dal Makhani', 24000, 50, '[]');

\echo ''
\echo '=== who may ask ==='

update public.test_flags set owns = false;
do $$
declare refused boolean := false;
begin
  begin
    perform public.restaurant_insights('c0de0000-0000-0000-0000-000000000001'::uuid);
  exception when insufficient_privilege then refused := true;
  end;
  perform public.assert(refused, 'someone with no role at the restaurant is refused');
end
$$;

-- A member of one restaurant is not a member of the next.
update public.test_flags set owns = true, only_rid = :'EMPTY';
do $$
declare refused boolean := false;
begin
  begin
    perform public.restaurant_insights('c0de0000-0000-0000-0000-000000000001'::uuid);
  exception when insufficient_privilege then refused := true;
  end;
  perform public.assert(refused, 'and so is the owner of a different restaurant');
end
$$;
update public.test_flags set owns = true, only_rid = null;

-- One call for the rest of the file: the numbers are read off the document.
create temp table doc as select public.restaurant_insights(:'R') as j;

\echo ''
\echo '=== sales by day ==='

select public.assert(
  (select jsonb_array_length(j -> 'days') = 30
          and (j -> 'days' -> 0 ->> 'date')::date = (select today from clock) - 29
          and (j -> 'days' -> 29 ->> 'date')::date = (select today from clock)
          and (j ->> 'today')::date = (select today from clock)
     from doc),
  'thirty days, oldest first, ending today by the restaurant''s calendar');

select public.assert(
  (select (j -> 'days' -> 29 ->> 'sales_cents')::bigint = 200000
          and (j -> 'days' -> 29 ->> 'bills')::int = 2
     from doc),
  'a bill paid at 00:30 local time is today''s money, though it is yesterday in UTC');

select public.assert(
  (select (j -> 'days' -> 22 ->> 'sales_cents')::bigint = 50000
          and (j -> 'days' -> 22 ->> 'bills')::int = 1
     from doc),
  'last week''s bill lands on the same weekday last week');

select public.assert(
  (select sum((d ->> 'sales_cents')::bigint) = 250000
     from doc, jsonb_array_elements(j -> 'days') d),
  'open bills and anything older than thirty days are not sales');

select public.assert(
  (select (j -> 'days' -> 28 ->> 'sales_cents')::bigint = 0
          and (j -> 'days' -> 28 ->> 'bills')::int = 0
          and (j -> 'days' -> 28 ->> 'orders')::int = 1
     from doc),
  'a day with orders and no settled bill reads zero sales, not a gap');

\echo ''
\echo '=== orders ==='

select public.assert(
  (select (j -> 'days' -> 29 ->> 'orders')::int = 2
          and (j -> 'days' -> 22 ->> 'orders')::int = 1
          and (select sum((d ->> 'orders')::int) from jsonb_array_elements(j -> 'days') d) = 4
     from doc),
  'only accepted orders count: not placed, rejected, cancelled or too old');

select public.assert(
  (select jsonb_array_length(j -> 'hours') = 24
          and (j -> 'hours' -> 13 ->> 'orders')::int = 2
          and (j -> 'hours' -> 20 ->> 'orders')::int = 2
          and (j -> 'hours' -> 7 ->> 'orders')::int = 0
     from doc),
  'orders fall in the hour on the restaurant''s wall clock, with zeros for quiet hours');

select public.assert(
  (select jsonb_array_length(j -> 'weekdays') = 7
          and (select sum((w ->> 'orders')::int) from jsonb_array_elements(j -> 'weekdays') w) = 4
          and (select sum((w ->> 'sales_cents')::bigint) from jsonb_array_elements(j -> 'weekdays') w) = 250000
     from doc),
  'the weekday split covers Monday to Sunday and loses nothing');

select public.assert(
  (select (w ->> 'orders')::int = 3 and (w ->> 'sales_cents')::bigint = 250000
     from doc, jsonb_array_elements(j -> 'weekdays') w
    where (w ->> 'dow')::int = extract(isodow from (select today from clock))::int),
  'today and the same day last week are the same weekday');

select public.assert(
  (select j -> 'mix' = '{"guest": 3, "waiter": 1, "dine_in": 3, "takeaway": 1}'::jsonb from doc),
  'orders split by who placed them and where they were eaten');

\echo ''
\echo '=== the menu ==='

select public.assert(
  (select jsonb_array_length(j -> 'top_dishes') = 3
          and j -> 'top_dishes' -> 0 = '{"name": "Gulab Jamun", "quantity": 4, "revenue_cents": 36000}'::jsonb
     from doc),
  'a dish that was deleted still shows what it sold, under the name it was sold as');

select public.assert(
  (select j -> 'top_dishes' -> 1 = '{"name": "Paneer Tikka", "quantity": 3, "revenue_cents": 94000}'::jsonb
     from doc),
  'a renamed dish is one row, under today''s name, with both prices added up');

select public.assert(
  (select j -> 'top_dishes' -> 2 = '{"name": "Dal Makhani", "quantity": 2, "revenue_cents": 48000}'::jsonb
     from doc),
  'lines on rejected orders sell nothing');

select public.assert(
  (select j -> 'unsold' = '{"count": 1, "names": ["Boondi Raita"]}'::jsonb from doc),
  'unsold means on the menu all thirty days, orderable now, and never ordered');

select public.assert(
  (select j -> 'addons' = '[{"name": "Extra butter", "count": 3}, {"name": "Extra chutney", "count": 2}]'::jsonb
     from doc),
  'add-ons are counted by the plates that carried them');

\echo ''
\echo '=== the floor right now ==='

select public.assert(
  (select j -> 'floor' = '{"tables_total": 3, "tables_occupied": 3, "open_bills": 2, "open_cents": 55000}'::jsonb
     from doc),
  'joined tables are each occupied, retired tables are not counted, open bills are totalled');

\echo ''
\echo '=== a restaurant with nothing yet ==='

select public.assert(
  (select jsonb_array_length(j -> 'days') = 30
          and (select sum((d ->> 'sales_cents')::bigint + (d ->> 'orders')::int + (d ->> 'bills')::int)
                 from jsonb_array_elements(j -> 'days') d) = 0
          and jsonb_array_length(j -> 'hours') = 24
          and jsonb_array_length(j -> 'weekdays') = 7
     from (select public.restaurant_insights(:'EMPTY') as j) e),
  'an empty restaurant still gets every day, hour and weekday, all at zero');

select public.assert(
  (select j -> 'top_dishes' = '[]'::jsonb
          and j -> 'addons' = '[]'::jsonb
          and j -> 'unsold' = '{"count": 0, "names": []}'::jsonb
          and j -> 'mix' = '{"guest": 0, "waiter": 0, "dine_in": 0, "takeaway": 0}'::jsonb
          and j -> 'floor' = '{"tables_total": 0, "tables_occupied": 0, "open_bills": 0, "open_cents": 0}'::jsonb
     from (select public.restaurant_insights(:'EMPTY') as j) e),
  'and empty lists and zeros rather than nulls');

select public.assert(
  (select j ->> 'timezone' = 'UTC' and jsonb_array_length(j -> 'days') = 30
     from (select public.restaurant_insights(:'ODD') as j) e),
  'a timezone Postgres does not know falls back to UTC instead of failing');

do $$
declare refused boolean := false;
begin
  begin
    perform public.restaurant_insights('c0de0000-0000-0000-0000-0000000009ff'::uuid);
  exception when others then refused := true;
  end;
  perform public.assert(refused, 'an unknown restaurant is an error, not an empty report');
end
$$;

delete from public.dishes where restaurant_id = :'R';
delete from public.restaurants where id in (:'R', :'EMPTY', :'ODD');
drop table doc;
drop table clock;

\echo ''
\echo 'ALL INSIGHTS ASSERTIONS PASSED'
