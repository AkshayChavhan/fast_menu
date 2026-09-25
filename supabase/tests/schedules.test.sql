-- Tests for schedule_is_open(), category_is_open() and dish_special_active()
-- from ../migrations/. Run with ../../scripts/test-sql.sh.

\pset tuples_only on
\pset format unaligned

\set REST  '55555555-5555-5555-5555-555555555555'
\set OWNER 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
\set BRK   '66666666-6666-6666-6666-666666666666'
\set LATE  '77777777-7777-7777-7777-777777777777'
\set OFF   '88888888-8888-8888-8888-888888888888'
\set CAT_B 'aaaaaaaa-0000-0000-0000-000000000001'
\set CAT_N 'aaaaaaaa-0000-0000-0000-000000000002'
\set D_SPEC 'bbbbbbbb-0000-0000-0000-000000000001'
\set D_PLAIN 'bbbbbbbb-0000-0000-0000-000000000002'

\echo ''
\echo '=== setup: a restaurant in Kolkata with three schedules ==='
insert into public.restaurants (id, owner_id, name, slug, timezone, trial_status)
values (:'REST', :'OWNER', 'Chai Point', 'chai', 'Asia/Kolkata', 'active');
insert into public.menu_schedules (id, restaurant_id, name, days, starts_at, ends_at, is_active) values
  (:'BRK',  :'REST', 'Breakfast',  '{1,2,3,4,5}', '07:00', '11:00', true),
  (:'LATE', :'REST', 'Late night', '{5}',         '22:00', '02:00', true),
  (:'OFF',  :'REST', 'Paused',     '{0}',         '00:00', '00:01', false);
insert into public.categories (id, restaurant_id, name, schedule_id) values
  (:'CAT_B', :'REST', 'Breakfast', :'BRK'),
  (:'CAT_N', :'REST', 'All day', null);
insert into public.dishes (id, restaurant_id, name, special_from, special_until) values
  (:'D_SPEC',  :'REST', 'Monsoon thali', '2026-09-20', '2026-09-22'),
  (:'D_PLAIN', :'REST', 'Chai', null, null);

-- 2026-09-22 is a Tuesday. 03:30 UTC is 09:00 in Kolkata.
\echo ''
\echo '=== schedule_is_open in the restaurant timezone ==='
select public.assert(public.schedule_is_open(:'BRK', '2026-09-22T03:30:00Z') = true,
  'Tuesday 09:00 IST is inside breakfast');
select public.assert(public.schedule_is_open(:'BRK', '2026-09-22T05:30:00Z') = false,
  'Tuesday 11:00 IST is the closing minute, so closed');
select public.assert(public.schedule_is_open(:'BRK', '2026-09-22T01:29:00Z') = false,
  'Tuesday 06:59 IST is before opening');
select public.assert(public.schedule_is_open(:'BRK', '2026-09-20T03:30:00Z') = false,
  'Sunday is not a breakfast day');
select public.assert(public.schedule_is_open(:'BRK', '2026-09-22T01:30:00Z') = true,
  'Tuesday 07:00 IST (01:30 UTC) is the opening minute');
select public.assert(public.schedule_is_open(:'BRK', '2026-09-21T23:00:00Z') = false,
  '23:00 UTC Monday is 04:30 IST Tuesday: right day, before opening');

\echo ''
\echo '=== overnight windows belong to their start day ==='
-- 2026-09-25 is a Friday. 17:30 UTC = 23:00 IST Friday; 19:30 UTC = 01:00 IST Saturday.
select public.assert(public.schedule_is_open(:'LATE', '2026-09-25T17:30:00Z') = true,  'Friday 23:00 IST is open');
select public.assert(public.schedule_is_open(:'LATE', '2026-09-25T19:30:00Z') = true,  'Saturday 01:00 IST is still Friday night');
select public.assert(public.schedule_is_open(:'LATE', '2026-09-25T21:30:00Z') = false, 'Saturday 03:00 IST is closed');
select public.assert(public.schedule_is_open(:'LATE', '2026-09-24T17:30:00Z') = false, 'Thursday 23:00 IST is closed');

\echo ''
\echo '=== missing or inactive schedules never restrict ==='
select public.assert(public.schedule_is_open(:'OFF', '2026-09-22T03:30:00Z') = true, 'an inactive schedule is open');
select public.assert(public.schedule_is_open(null, now()) = true, 'a null schedule is open');
select public.assert(public.schedule_is_open('00000000-0000-0000-0000-000000000000', now()) = true, 'an unknown schedule is open');

\echo ''
\echo '=== category_is_open ==='
select public.assert(public.category_is_open(:'CAT_B', '2026-09-22T03:30:00Z') = true,  'a scheduled category follows its schedule (open)');
select public.assert(public.category_is_open(:'CAT_B', '2026-09-22T09:30:00Z') = false, 'a scheduled category follows its schedule (closed)');
select public.assert(public.category_is_open(:'CAT_N', '2026-09-22T09:30:00Z') = true,  'an unscheduled category is always open');
select public.assert(public.category_is_open('00000000-0000-0000-0000-000000000000', now()) = true, 'an unknown category is open');

\echo ''
\echo '=== dish_special_active uses the local calendar date ==='
select public.assert(public.dish_special_active(:'D_SPEC', '2026-09-22T03:30:00Z') = true,  'inside the window');
select public.assert(public.dish_special_active(:'D_SPEC', '2026-09-22T20:00:00Z') = false, '20:00 UTC on the 22nd is already the 23rd in Kolkata');
select public.assert(public.dish_special_active(:'D_SPEC', '2026-09-19T20:00:00Z') = true,  '20:00 UTC on the 19th is the 20th in Kolkata, the first day');
select public.assert(public.dish_special_active(:'D_PLAIN', now()) = true, 'a dish with no window is always active');
select public.assert(public.dish_special_active('00000000-0000-0000-0000-000000000000', now()) = true, 'an unknown dish is active');

\echo ''
\echo 'ALL SCHEDULE ASSERTIONS PASSED'
