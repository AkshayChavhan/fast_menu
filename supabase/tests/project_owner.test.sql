-- Tests for the project-owner level, from ../migrations/*_project_owner.sql.
-- Run with ../../scripts/test-sql.sh.
--
-- What is pinned down: a plain admin can look but not change money or the
-- admin list; the last owner cannot lock everyone out; every owner change
-- leaves an audit row; the restaurant detail never carries orders or takings.

\pset tuples_only on
\pset format unaligned

\set R 'a0a40000-0000-0000-0000-000000000001'
\set OWNER 'a0a40000-0000-0000-0000-0000000000aa'
\set STAFF 'a0a40000-0000-0000-0000-0000000000bb'

insert into auth.users (id, email) values (:'OWNER', 'owner@po.example');
insert into public.restaurants (id, owner_id, name, slug, city, phone, plan, is_published, trial_status, trial_ends_at)
values (:'R', :'OWNER', 'PO Café', 'po-cafe', 'Nagpur', '+91 93311 55555', 'starter', true, 'active', now() + interval '5 days');
insert into public.categories (id, restaurant_id, name, sort_order)
values ('a0a40000-0000-0000-0000-00000000c001', :'R', 'Mains', 1);
insert into public.dishes (restaurant_id, category_id, name, price_cents, is_available)
values (:'R', 'a0a40000-0000-0000-0000-00000000c001', 'Paneer Tikka', 24000, true),
       (:'R', 'a0a40000-0000-0000-0000-00000000c001', 'Dal Fry', 16000, false);
insert into public.restaurant_staff (restaurant_id, user_id, role, display_name, is_active)
values (:'R', :'STAFF', 'waiter', 'Ravi', true);
insert into public.payments (restaurant_id, provider_order_id, plan, months, amount_paise, status, paid_at)
values (:'R', 'order_po_1', 'pro', 12, 500000, 'paid', now());

delete from public.platform_admins where email in ('po-owner@example.com', 'po-admin@example.com', 'po-new@example.com');
insert into public.platform_admins (email, role) values
  ('po-owner@example.com', 'project_owner'),
  ('po-admin@example.com', 'admin');

\echo ''
\echo '=== who is what ==='

update public.test_auth set email = 'nobody@example.com';
select public.assert(public.platform_admin_role() is null, 'a stranger has no role');
select public.assert(public.is_project_owner() = false, 'and is not an owner');

update public.test_auth set email = 'PO-Admin@Example.com';
select public.assert(public.platform_admin_role() = 'admin', 'an admin reads as admin, case aside');
select public.assert(public.is_platform_admin() = true, 'an admin is still a platform admin');
select public.assert(public.is_project_owner() = false, 'but not an owner');

update public.test_auth set email = 'po-owner@example.com';
select public.assert(public.platform_admin_role() = 'project_owner', 'the owner reads as owner');
select public.assert(public.is_platform_admin() = true, 'and is a platform admin too');

\echo ''
\echo '=== plans are owner only ==='

update public.test_auth set email = 'po-admin@example.com';
do $$
begin
  perform public.set_restaurant_plan('a0a40000-0000-0000-0000-000000000001', 'pro', 12);
  raise exception 'FAIL  an admin could set a plan';
exception when insufficient_privilege then
  raise notice '  PASS  an admin cannot set a plan';
end $$;
select public.assert(
  (select count(*) from public.list_restaurant_plans() where restaurant_id = :'R') = 1,
  'but can still see the plans list');

update public.test_auth set email = 'po-owner@example.com';
select public.assert(
  (public.set_restaurant_plan(:'R', 'pro', 12) ->> 'effective_plan') = 'pro',
  'the owner can set a plan');
select public.assert(
  (select count(*) from public.platform_audit
    where action = 'plan.set' and target = :'R' and actor = 'po-owner@example.com'
      and details -> 'to' ->> 'plan' = 'pro' and details -> 'from' ->> 'plan' = 'starter') = 1,
  'and it is audited with before and after');

\echo ''
\echo '=== payments are owner only ==='

update public.test_auth set email = 'po-admin@example.com';
select public.assert((select count(*) from public.list_payments()) = 0, 'an admin sees no payments');
update public.test_auth set email = 'po-owner@example.com';
select public.assert(
  (select amount_paise from public.list_payments() where restaurant_id = :'R') = 500000,
  'the owner sees them with the restaurant name');

\echo ''
\echo '=== managing admins ==='

update public.test_auth set email = 'po-admin@example.com';
do $$
begin
  perform public.set_platform_admin('po-new@example.com', 'admin');
  raise exception 'FAIL  an admin could add an admin';
exception when insufficient_privilege then
  raise notice '  PASS  an admin cannot add an admin';
end $$;
select public.assert((select count(*) from public.list_platform_admins()) = 0,
  'an admin cannot read the admin list');

update public.test_auth set email = 'po-owner@example.com';
select public.set_platform_admin('  PO-New@Example.com ', 'admin');
select public.assert(
  (select role from public.platform_admins where email = 'po-new@example.com') = 'admin',
  'the owner adds an admin, email lower-cased and trimmed');
select public.set_platform_admin('po-new@example.com', 'project_owner');
select public.assert(
  (select role from public.platform_admins where email = 'po-new@example.com') = 'project_owner',
  'and can promote them');
select public.assert(
  (select count(*) from public.platform_audit where action = 'admin.set' and target = 'po-new@example.com') = 2,
  'both changes are audited');

do $$
begin
  perform public.set_platform_admin('not-an-email', 'admin');
  raise exception 'FAIL  a non-email was accepted';
exception when invalid_parameter_value then
  raise notice '  PASS  a non-email is refused';
end $$;

select public.remove_platform_admin('po-new@example.com');
select public.assert(
  not exists (select 1 from public.platform_admins where email = 'po-new@example.com'),
  'the owner removes an admin');

do $$
begin
  perform public.remove_platform_admin('po-owner@example.com');
  raise exception 'FAIL  the last owner could be removed';
exception when invalid_parameter_value then
  raise notice '  PASS  the last owner cannot be removed';
end $$;
do $$
begin
  perform public.set_platform_admin('po-owner@example.com', 'admin');
  raise exception 'FAIL  the last owner could be demoted';
exception when invalid_parameter_value then
  raise notice '  PASS  the last owner cannot be demoted';
end $$;

select public.assert(
  (select count(*) from public.list_platform_audit(10)) >= 4,
  'the owner reads the audit log');
update public.test_auth set email = 'po-admin@example.com';
select public.assert((select count(*) from public.list_platform_audit(10)) = 0,
  'an admin does not');

\echo ''
\echo '=== the view-only restaurant page ==='

update public.test_auth set email = 'nobody@example.com';
do $$
begin
  perform public.admin_restaurant_detail('a0a40000-0000-0000-0000-000000000001');
  raise exception 'FAIL  a stranger could read a restaurant';
exception when insufficient_privilege then
  raise notice '  PASS  a stranger is refused';
end $$;

update public.test_auth set email = 'po-admin@example.com';
select public.admin_restaurant_detail(:'R') as d \gset
select public.assert(
  (:'d'::jsonb -> 'restaurant' ->> 'name') = 'PO Café'
  and (:'d'::jsonb -> 'restaurant' ->> 'owner_email') = 'owner@po.example'
  and (:'d'::jsonb -> 'restaurant' ->> 'effective_plan') = 'pro',
  'an admin sees the profile, owner and plan');
select public.assert(
  jsonb_array_length(:'d'::jsonb -> 'staff') = 1
  and (:'d'::jsonb -> 'staff' -> 0 ->> 'display_name') = 'Ravi',
  'and the staff roster');
select public.assert(
  jsonb_array_length(:'d'::jsonb -> 'menu' -> 0 -> 'dishes') = 2
  and (:'d'::jsonb -> 'menu' -> 0 -> 'dishes' -> 0 ->> 'name') = 'Dal Fry',
  'and the menu by category, dishes by sort order then name');
select public.assert(
  not (:'d'::jsonb ? 'payments'),
  'but no payments');
select public.assert(
  not (:'d'::jsonb ? 'orders') and not (:'d'::jsonb ? 'revenue') and not (:'d'::jsonb ? 'reviews'),
  'and never orders, revenue or reviews');

update public.test_auth set email = 'po-owner@example.com';
select public.admin_restaurant_detail(:'R') as d2 \gset
select public.assert(
  jsonb_array_length(:'d2'::jsonb -> 'payments') = 1,
  'the owner also sees that restaurant''s payments');

do $$
begin
  perform public.admin_restaurant_detail('a0a40000-0000-0000-0000-0000000000ff');
  raise exception 'FAIL  an unknown restaurant returned something';
exception when invalid_parameter_value then
  raise notice '  PASS  an unknown restaurant is an error';
end $$;

delete from public.platform_admins where email in ('po-owner@example.com', 'po-admin@example.com');
update public.test_auth set email = null;
