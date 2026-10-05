-- Tests for restaurant_plan() and the plan gate on ordering, from
-- ../migrations/*_plans.sql. Run with ../../scripts/test-sql.sh.
--
-- The gate is what separates a INR 2,000 starter from a INR 5,000 pro, so it
-- is checked in the database and not only in the dashboard: the anon key is in
-- every guest's browser.

\pset tuples_only on
\pset format unaligned

\set R 'b1a40000-0000-0000-0000-000000000001'
\set OWNER 'b1a40000-0000-0000-0000-0000000000aa'

insert into public.restaurants
  (id, owner_id, name, slug, is_published, trial_status, trial_ends_at, plan, ordering_enabled)
values
  (:'R', :'OWNER', 'Plan Café', 'plan-cafe', true, 'denied', now() - interval '1 day',
   'starter', true);

\echo ''
\echo '=== restaurant_plan() ==='

select public.assert(public.restaurant_plan(:'R') = 'starter', 'a starter with no live trial is a starter');

-- NULL plan_expires_at means no paid subscription, not "pro forever". Comping
-- an account is done by setting the date far out.
update public.restaurants set plan = 'pro', plan_expires_at = null where id = :'R';
select public.assert(public.restaurant_plan(:'R') = 'starter',
  'plan = pro with no paid term is not pro');

update public.restaurants set plan_expires_at = now() + interval '30 days' where id = :'R';
select public.assert(public.restaurant_plan(:'R') = 'pro', 'a paid plan inside its term is pro');

-- The point of computing rather than storing: nothing has to run on renewal
-- day for the downgrade to happen.
update public.restaurants set plan_expires_at = now() - interval '1 day' where id = :'R';
select public.assert(public.restaurant_plan(:'R') = 'starter', 'an expired paid plan falls back on its own');

update public.restaurants set plan = 'starter', plan_expires_at = null,
       trial_status = 'active', trial_ends_at = now() + interval '5 days' where id = :'R';
select public.assert(public.restaurant_plan(:'R') = 'pro', 'a live trial runs as pro');

update public.restaurants set trial_status = 'needs_review' where id = :'R';
select public.assert(public.restaurant_plan(:'R') = 'pro', 'a hotel under review keeps pro while it builds');

update public.restaurants set trial_status = 'active', trial_ends_at = now() - interval '1 day' where id = :'R';
select public.assert(public.restaurant_plan(:'R') = 'starter', 'an expired trial drops to starter');

update public.restaurants set trial_status = 'pending', trial_ends_at = now() + interval '5 days' where id = :'R';
select public.assert(public.restaurant_plan(:'R') = 'starter', 'an unclaimed trial grants nothing');

\echo ''
\echo '=== the grace period ==='

-- The point of the grace period: a printed QR code glued to a table must not
-- stop working the day a card fails.
update public.restaurants set is_published = true, plan = 'pro',
       plan_expires_at = now() - interval '1 day',
       trial_status = 'denied', trial_ends_at = now() - interval '90 days'
 where id = :'R';

select public.assert(public.restaurant_plan(:'R') = 'starter',
  'an expired paid term stops being pro at once');
select public.assert(public.restaurant_is_live(:'R'),
  'but the menu stays up inside the grace period');

update public.restaurants set plan_expires_at = now() - interval '400 days' where id = :'R';
select public.assert(not public.restaurant_is_live(:'R'),
  'past the grace period the menu goes dark');

-- Renewing moves the entitlement forward again.
update public.restaurants set plan_expires_at = now() + interval '365 days' where id = :'R';
select public.assert(public.restaurant_plan(:'R') = 'pro', 'renewing restores pro');
select public.assert(public.restaurant_is_live(:'R'), 'and the menu with it');

-- A paid starter is live without ever being pro: the whole point of the
-- INR 2,000 plan.
update public.restaurants set plan = 'starter', plan_expires_at = now() + interval '365 days'
 where id = :'R';
select public.assert(public.restaurant_is_live(:'R'), 'a paid starter has a live menu');
select public.assert(public.restaurant_plan(:'R') = 'starter', 'and is still not pro');

-- An unpublished restaurant is never live, whatever it has paid.
update public.restaurants set is_published = false where id = :'R';
select public.assert(not public.restaurant_is_live(:'R'), 'unpublished is never live');
update public.restaurants set is_published = true where id = :'R';

\echo ''
\echo '=== the ordering gate ==='

-- Exercised through staff_create_order(), not place_order(). place_order()
-- already refuses unless trial_status = 'active' and the trial is live (see
-- *_orders.sql), and a live trial *is* pro — so a starter restaurant can never
-- reach the plan check there. The staff path has no trial coupling, so it is
-- where the gate is actually observable today.
--
-- That coupling is worth revisiting: as written, a paying pro customer loses
-- guest ordering the day their trial lapses, because place_order() asks about
-- the trial rather than the plan.

insert into public.categories (id, restaurant_id, name) values
  ('b1a40000-0000-0000-0000-0000000000c1', :'R', 'Chai');
insert into public.dishes (id, restaurant_id, category_id, name, price_cents, is_available) values
  ('b1a40000-0000-0000-0000-0000000000d1', :'R',
   'b1a40000-0000-0000-0000-0000000000c1', 'Masala Chai', 9000, true);
insert into public.tables (id, restaurant_id, label, qr_token, is_active)
values ('b1a40000-0000-0000-0000-0000000000f1'::uuid, :'R', 'T1', 'plan-tok', true);

-- Act as the owner.
update public.test_auth set uid = :'OWNER';

-- starter, with ordering_enabled still true: exactly the state a restaurant is
-- left in when it downgrades.
update public.restaurants set plan = 'starter', plan_expires_at = null,
       trial_status = 'denied', trial_ends_at = now() - interval '1 day',
       ordering_enabled = true where id = :'R';
select public.assert(public.restaurant_plan(:'R') = 'starter', 'setup: it really is on starter');

do $$
declare ok boolean := false; msg text;
begin
  begin
    perform public.staff_create_order(
      'b1a40000-0000-0000-0000-000000000001'::uuid,
      array['b1a40000-0000-0000-0000-0000000000f1']::uuid[],
      'dine_in', null, null,
      '[{"dish_id": "b1a40000-0000-0000-0000-0000000000d1", "quantity": 1}]'::jsonb);
  exception when others then
    ok := true; msg := SQLERRM;
  end;
  perform public.assert(ok, 'a waiter cannot take an order on starter');
  perform public.assert(msg like '%Pro plan%', 'and is told it needs the Pro plan');
end
$$;

select public.assert(
  (select count(*) from public.orders where restaurant_id = :'R') = 0,
  'no order row survives the refusal');

-- A paid term, not just the column: NULL plan_expires_at is no subscription.
update public.restaurants set plan = 'pro', plan_expires_at = now() + interval '365 days'
 where id = :'R';
select public.assert(public.restaurant_plan(:'R') = 'pro', 'setup: now on pro');

select public.staff_create_order(
  'b1a40000-0000-0000-0000-000000000001'::uuid,
  array['b1a40000-0000-0000-0000-0000000000f1']::uuid[],
  'dine_in', null, null,
  '[{"dish_id": "b1a40000-0000-0000-0000-0000000000d1", "quantity": 1}]'::jsonb);

select public.assert(
  (select count(*) from public.orders where restaurant_id = :'R') = 1,
  'the same order goes through on pro');

update public.test_auth set uid = null;

\echo ''
\echo '=== the operator sets the plan ==='

-- Start from a restaurant with nothing paid.
update public.restaurants set plan = 'starter', plan_expires_at = null,
       trial_status = 'denied', trial_ends_at = now() - interval '90 days'
 where id = :'R';
update public.test_auth set uid = null, email = 'nobody@example.com';

do $$
declare refused boolean := false;
begin
  begin
    perform public.set_restaurant_plan('b1a40000-0000-0000-0000-000000000001'::uuid, 'pro', 12);
  exception when others then refused := true;
  end;
  perform public.assert(refused, 'a non-admin cannot hand out a plan');
end
$$;

select public.assert(public.restaurant_plan(:'R') = 'starter', 'and nothing changed');

insert into public.platform_admins (email) values ('ops@example.com');
update public.test_auth set email = 'ops@example.com';

select public.set_restaurant_plan(:'R', 'pro', 12);
select public.assert(public.restaurant_plan(:'R') = 'pro', 'the admin can grant pro');
select public.assert(
  (select plan_expires_at between now() + interval '360 days' and now() + interval '370 days'
   from public.restaurants where id = :'R'),
  'the term runs a year from now');

-- Renewing early must add to the term, not reset it to a year from today.
select public.set_restaurant_plan(:'R', 'pro', 12);
select public.assert(
  (select plan_expires_at > now() + interval '700 days'
   from public.restaurants where id = :'R'),
  'renewing early stacks onto the term it has left');

-- Dropping a tier keeps the paid term: they bought time, not just features.
select public.set_restaurant_plan(:'R', 'starter', 0);
select public.assert(
  (select plan = 'starter' and plan_expires_at is null
   from public.restaurants where id = :'R'),
  'zero months clears the paid term');
select public.assert(public.restaurant_plan(:'R') = 'starter', 'which drops them off pro');

-- The menu must not go dark the instant an operator ends a subscription.
update public.restaurants set is_published = true where id = :'R';
select public.assert(public.restaurant_is_live(:'R') = false,
  'a long-dead trial plus no paid term is past grace already');

select public.set_restaurant_plan(:'R', 'pro', 1);
select public.assert(public.restaurant_is_live(:'R'), 'granting a term brings the menu back');

do $$
declare refused boolean := false;
begin
  begin
    perform public.set_restaurant_plan('b1a40000-0000-0000-0000-000000000001'::uuid, 'enterprise', 12);
  exception when others then refused := true;
  end;
  perform public.assert(refused, 'an unknown tier is refused');
end
$$;

select public.assert(
  (select count(*) from public.list_restaurant_plans() where restaurant_id = :'R') = 1,
  'the restaurant shows up in the operator listing');

update public.test_auth set email = 'nobody@example.com';
select public.assert(
  (select count(*) from public.list_restaurant_plans()) = 0,
  'and the listing is empty for everyone else');

delete from public.platform_admins where email = 'ops@example.com';
update public.test_auth set uid = null, email = null;

delete from public.restaurants where id = :'R';

\echo ''
\echo 'ALL PLAN ASSERTIONS PASSED'
