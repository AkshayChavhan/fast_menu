-- Tests for operator_placeholder_restaurants() and
-- remove_placeholder_restaurant(), from ../migrations/*_operator_accounts.sql.
-- Run with ../../scripts/test-sql.sh.
--
-- What matters: only an operator's empty, unpublished starter restaurant is
-- ever offered for removal; anything with a dish, a table or an order is a
-- real restaurant whoever owns it.

\pset tuples_only on
\pset format unaligned

\set OP   '0eaa0000-0000-0000-0000-0000000000aa'
\set CUST '0eaa0000-0000-0000-0000-0000000000bb'
\set EMPTY 'aaaa0000-0000-0000-0000-000000000001'
\set REAL  'aaaa0000-0000-0000-0000-000000000002'
\set PUBD  'aaaa0000-0000-0000-0000-000000000003'
\set OTHER 'aaaa0000-0000-0000-0000-000000000004'

insert into auth.users (id, email) values (:'OP', 'op@example.com'), (:'CUST', 'cust@example.com');
insert into public.platform_admins (email, role) values ('op@example.com', 'project_owner')
on conflict (email) do update set role = 'project_owner';
update public.test_auth set email = 'op@example.com';

insert into public.restaurants (id, owner_id, name, slug, is_published) values
  (:'EMPTY', :'OP', 'My Restaurant', 'op', false),
  (:'REAL',  :'OP', 'Op Demo Café', 'op-demo', false),
  (:'PUBD',  :'OP', 'Op Live', 'op-live', true),
  (:'OTHER', :'CUST', 'My Restaurant', 'cust', false);
insert into public.dishes (restaurant_id, name) values (:'REAL', 'Chai');

\echo ''
\echo '=== operator_placeholder_restaurants() ==='
select public.assert(
  (select string_agg(slug, ',' order by slug) from public.operator_placeholder_restaurants()) = 'op',
  'only the empty, unpublished one owned by an operator is a placeholder');

update public.test_auth set email = 'cust@example.com';
select public.assert(
  (select count(*) from public.operator_placeholder_restaurants()) = 0,
  'a restaurant owner sees nothing');

\echo ''
\echo '=== remove_placeholder_restaurant() ==='
do $$
begin
  perform public.remove_placeholder_restaurant('aaaa0000-0000-0000-0000-000000000001');
  raise exception 'FAIL  a non-owner could remove a placeholder';
exception when insufficient_privilege then
  raise notice '  PASS  a non-owner is refused';
end $$;

update public.test_auth set email = 'op@example.com';
do $$
begin
  perform public.remove_placeholder_restaurant('aaaa0000-0000-0000-0000-000000000002');
  raise exception 'FAIL  a restaurant with a dish was removed';
exception when invalid_parameter_value then
  raise notice '  PASS  a restaurant with anything in it is refused';
end $$;
do $$
begin
  perform public.remove_placeholder_restaurant('aaaa0000-0000-0000-0000-000000000004');
  raise exception 'FAIL  a customer''s empty restaurant was removed';
exception when invalid_parameter_value then
  raise notice '  PASS  an empty restaurant that is not an operator''s is refused';
end $$;

select public.remove_placeholder_restaurant(:'EMPTY');
select public.assert(
  not exists (select 1 from public.restaurants where id = :'EMPTY'),
  'the placeholder is gone');
select public.assert(
  exists (select 1 from public.restaurants where id = :'REAL')
  and exists (select 1 from public.restaurants where id = :'OTHER'),
  'and nothing else is');
select public.assert(
  (select count(*) from public.platform_audit
    where action = 'restaurant.remove_placeholder' and target = :'EMPTY'
      and details ->> 'owner_email' = 'op@example.com') = 1,
  'the removal is audited');

delete from public.platform_admins where email = 'op@example.com';
update public.test_auth set email = null;
