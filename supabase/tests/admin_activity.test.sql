-- Tests for list_restaurant_activity(), from ../migrations/*_admin_activity.sql.
-- Run with ../../scripts/test-sql.sh.
--
-- The operator dashboard decides who to call from these numbers, so what is
-- pinned down here is what gets counted: accepted orders only, active rows
-- only, and nothing at all for someone who is not a platform admin.

\pset tuples_only on
\pset format unaligned

\set BUSY 'ac710000-0000-0000-0000-000000000001'
\set EMPTY 'ac710000-0000-0000-0000-000000000002'
\set OWNER 'ac710000-0000-0000-0000-0000000000aa'

insert into auth.users (id, email) values (:'OWNER', 'owner@busy.example');

insert into public.restaurants
  (id, owner_id, name, slug, city, phone, is_published, trial_status, trial_ends_at,
   plan, ordering_enabled, kds_enabled, google_review_url, created_at)
values
  (:'BUSY', :'OWNER', 'Busy Bhojnalaya', 'busy-bhojnalaya', 'Nagpur', '+919800000001',
   true, 'active', now() + interval '10 days', 'starter', true, true,
   'https://g.page/r/busy/review', now() - interval '60 days'),
  -- No owner row in auth.users on purpose: the restaurant must still be listed.
  (:'EMPTY', 'ac710000-0000-0000-0000-0000000000bb', 'Empty Cafe', 'empty-cafe', null, null,
   false, 'pending', now() + interval '15 days', 'starter', false, false,
   null, now() - interval '2 days');

insert into public.dishes (restaurant_id, name, image_url) values
  (:'BUSY', 'Paneer Tikka', 'https://img.example/paneer.jpg'),
  (:'BUSY', 'Dal Makhani', 'https://img.example/dal.jpg'),
  (:'BUSY', 'Jeera Rice', null);

insert into public.tables (restaurant_id, label, is_active) values
  (:'BUSY', 'T1', true), (:'BUSY', 'T2', true), (:'BUSY', 'T3', true),
  (:'BUSY', 'T4', true), (:'BUSY', 'Old patio', false);

insert into public.restaurant_staff (restaurant_id, user_id, role, is_active) values
  (:'BUSY', gen_random_uuid(), 'waiter', true),
  (:'BUSY', gen_random_uuid(), 'kitchen', true),
  (:'BUSY', gen_random_uuid(), 'cashier', false);

insert into public.orders (restaurant_id, code, currency, status, source, created_at) values
  (:'BUSY', 'AAAAAA', 'INR', 'approved',  'customer', now() - interval '1 hour'),
  (:'BUSY', 'BBBBBB', 'INR', 'settled',   'waiter',   now() - interval '3 days'),
  (:'BUSY', 'CCCCCC', 'INR', 'settled',   'customer', now() - interval '10 days'),
  (:'BUSY', 'DDDDDD', 'INR', 'settled',   'waiter',   now() - interval '20 days'),
  (:'BUSY', 'EEEEEE', 'INR', 'settled',   'customer', now() - interval '40 days'),
  -- Never accepted by staff, so none of these is the restaurant using us.
  (:'BUSY', 'FFFFFF', 'INR', 'placed',    'customer', now() - interval '5 minutes'),
  (:'BUSY', 'GGGGGG', 'INR', 'rejected',  'customer', now() - interval '2 hours'),
  (:'BUSY', 'HHHHHH', 'INR', 'cancelled', 'customer', now() - interval '2 hours');

insert into public.payments
  (restaurant_id, provider_order_id, plan, months, amount_paise, status, created_at, paid_at)
values
  (:'BUSY', 'order_act_old',  'starter', 12, 200000, 'paid',   now() - interval '40 days', now() - interval '40 days'),
  (:'BUSY', 'order_act_paid', 'pro',     12, 500000, 'paid',   now() - interval '2 hours', now() - interval '1 minute'),
  (:'BUSY', 'order_act_fail', 'pro',     12, 500000, 'failed', now() - interval '1 minute', null);

\echo ''
\echo '=== who may look ==='

update public.test_auth set uid = null, email = 'nobody@example.com';
select public.assert(
  (select count(*) from public.list_restaurant_activity()) = 0,
  'the listing is empty for someone who is not a platform admin');

insert into public.platform_admins (email) values ('ops@example.com');
update public.test_auth set email = 'ops@example.com';

select public.assert(
  (select count(*) from public.list_restaurant_activity()
    where restaurant_id in (:'BUSY', :'EMPTY')) = 2,
  'a platform admin sees every restaurant, even one whose owner row is missing');

\echo ''
\echo '=== a restaurant in use ==='

select public.assert(
  (select owner_email = 'owner@busy.example' and city = 'Nagpur' and phone = '+919800000001'
     from public.list_restaurant_activity() where restaurant_id = :'BUSY'),
  'the row carries who to call');

select public.assert(
  (select effective_plan = 'pro' and is_live and is_published
     from public.list_restaurant_activity() where restaurant_id = :'BUSY'),
  'a live trial reads as pro and live, as the plans listing does');

select public.assert(
  (select dish_count = 3 and dish_photo_count = 2
     from public.list_restaurant_activity() where restaurant_id = :'BUSY'),
  'dishes are counted, and those with a photo separately');

select public.assert(
  (select table_count = 4 and staff_count = 2
     from public.list_restaurant_activity() where restaurant_id = :'BUSY'),
  'retired tables and deactivated staff are not counted');

select public.assert(
  (select ordering_enabled and kds_enabled and has_review_link
     from public.list_restaurant_activity() where restaurant_id = :'BUSY'),
  'the setup switches come through');

select public.assert(
  (select last_menu_edit_at > now() - interval '1 minute'
     from public.list_restaurant_activity() where restaurant_id = :'BUSY'),
  'the last menu edit is the newest dish change');

select public.assert(
  (select orders_7d = 2 and orders_prev_7d = 1 and orders_30d = 4
     from public.list_restaurant_activity() where restaurant_id = :'BUSY'),
  'only accepted orders count, bucketed by when they were placed');

select public.assert(
  (select guest_orders_30d = 2
     from public.list_restaurant_activity() where restaurant_id = :'BUSY'),
  'orders guests placed themselves are counted apart from waiter-typed ones');

select public.assert(
  (select last_order_at between now() - interval '2 hours' and now() - interval '30 minutes'
     from public.list_restaurant_activity() where restaurant_id = :'BUSY'),
  'the last order ignores the newer one nobody approved');

select public.assert(
  (select last_payment_status = 'failed' and last_payment_at > now() - interval '5 minutes'
     from public.list_restaurant_activity() where restaurant_id = :'BUSY'),
  'the latest payment attempt is reported, whatever came before it');

select public.assert(
  (select paid_this_month_paise = 500000
     from public.list_restaurant_activity() where restaurant_id = :'BUSY'),
  'money received this month leaves out last month and failed attempts');

\echo ''
\echo '=== a restaurant nobody has set up ==='

select public.assert(
  (select dish_count = 0 and dish_photo_count = 0 and table_count = 0 and staff_count = 0
          and orders_7d = 0 and orders_prev_7d = 0 and orders_30d = 0 and guest_orders_30d = 0
          and paid_this_month_paise = 0
     from public.list_restaurant_activity() where restaurant_id = :'EMPTY'),
  'an empty restaurant reports zeros, not nulls');

select public.assert(
  (select last_order_at is null and last_menu_edit_at is null
          and last_payment_status is null and last_payment_at is null
          and owner_email is null
     from public.list_restaurant_activity() where restaurant_id = :'EMPTY'),
  'and nothing where nothing has happened');

select public.assert(
  (select not is_live and not is_published and not has_review_link
          and effective_plan = 'starter'
     from public.list_restaurant_activity() where restaurant_id = :'EMPTY'),
  'an unclaimed trial is a dark starter');

select public.assert(
  (select (array_agg(restaurant_id order by rn))[1] = :'EMPTY'
     from (select restaurant_id, row_number() over () as rn
             from public.list_restaurant_activity()
            where restaurant_id in (:'BUSY', :'EMPTY')) x),
  'newest sign-ups come first');

delete from public.platform_admins where email = 'ops@example.com';
update public.test_auth set uid = null, email = null;
delete from public.dishes where restaurant_id in (:'BUSY', :'EMPTY');
delete from public.restaurants where id in (:'BUSY', :'EMPTY');
delete from auth.users where id = :'OWNER';

\echo ''
\echo 'ALL ADMIN ACTIVITY ASSERTIONS PASSED'
