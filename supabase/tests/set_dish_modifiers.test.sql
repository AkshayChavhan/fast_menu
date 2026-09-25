-- Tests for public.set_dish_modifiers(uuid, jsonb) from ../migrations/.
-- Run with ../../scripts/test-sql.sh.

\pset tuples_only on
\pset format unaligned

\set R    '11111111-1111-1111-1111-111111111111'
\set DISH '99999999-9999-9999-9999-999999999999'

\echo ''
\echo '=== setup ==='
update public.test_flags set owns = true;
insert into public.dishes (id, restaurant_id, name, price_cents) values (:'DISH', :'R', 'Paneer Tikka', 30000);

\echo ''
\echo '=== a first save creates groups and options in order ==='
select public.assert(
  public.set_dish_modifiers(:'DISH', $j$[
    {"name": "Size", "kind": "variant",
     "options": [{"name": "Half", "price_cents": 18000, "is_default": true},
                 {"name": "Full", "price_cents": 30000}]},
    {"name": "Extras", "kind": "addon", "min_select": 0, "max_select": 2,
     "options": [{"name": "Extra chutney", "price_cents": 2000},
                 {"name": "Cheese", "price_cents": 4000, "is_available": false, "is_default": true}]}
  ]$j$::jsonb) = '{"groups": 2, "options": 4}'::jsonb,
  'returns the counts');
select public.assert(
  (select array_agg(name order by sort_order) from public.modifier_groups where dish_id = :'DISH') = array['Size', 'Extras'],
  'groups keep payload order');
select public.assert(
  (select array_agg(o.name order by o.sort_order)
     from public.modifier_options o join public.modifier_groups g on g.id = o.group_id
    where g.dish_id = :'DISH' and g.name = 'Size') = array['Half', 'Full'],
  'options keep payload order');
select public.assert(
  (select min_select = 1 and max_select = 1 from public.modifier_groups where dish_id = :'DISH' and name = 'Size'),
  'a variant group is always exactly one');
select public.assert(
  (select min_select = 0 and max_select = 2 from public.modifier_groups where dish_id = :'DISH' and name = 'Extras'),
  'an addon group keeps its min and max');
select public.assert(
  (select is_default from public.modifier_options where name = 'Half') = true
  and (select is_default from public.modifier_options where name = 'Cheese') = false,
  'is_default is honoured for variants and ignored for add-ons');
select public.assert(
  (select is_available from public.modifier_options where name = 'Cheese') = false,
  'an option can start unavailable');
select public.assert(
  (select restaurant_id from public.modifier_options where name = 'Half') = :'R',
  'options are stamped with the restaurant for RLS');

\echo ''
\echo '=== saving again replaces everything ==='
select public.assert(
  public.set_dish_modifiers(:'DISH', $j$[
    {"name": "Portion", "kind": "variant", "options": [{"name": "Regular", "price_cents": 25000}]}
  ]$j$::jsonb) = '{"groups": 1, "options": 1}'::jsonb,
  'the second save reports its own counts');
select public.assert(
  (select count(*) from public.modifier_groups where dish_id = :'DISH') = 1
  and (select count(*) from public.modifier_options o join public.modifier_groups g on g.id = o.group_id where g.dish_id = :'DISH') = 1,
  'old groups and options are gone');
-- Two statements: a subquery in the same statement as the call would read
-- the statement's starting snapshot and not see the deletes.
select public.assert(
  public.set_dish_modifiers(:'DISH', '[]'::jsonb) = '{"groups": 0, "options": 0}'::jsonb,
  'an empty payload reports zero');
select public.assert(
  (select count(*) from public.modifier_groups where dish_id = :'DISH') = 0,
  'an empty payload clears the dish');

\echo ''
\echo '=== validation ==='
do $$
begin
  perform public.set_dish_modifiers('99999999-9999-9999-9999-999999999999',
    '[{"name": "Size", "kind": "variant", "options": []}]'::jsonb);
  raise exception 'FAIL  a variant group with no options should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  a variant group needs at least one option';
end $$;
do $$
begin
  perform public.set_dish_modifiers('99999999-9999-9999-9999-999999999999',
    '[{"name": "Size", "kind": "sauce", "options": [{"name": "x"}]}]'::jsonb);
  raise exception 'FAIL  an unknown kind should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  an unknown kind is refused';
end $$;
do $$
begin
  perform public.set_dish_modifiers('99999999-9999-9999-9999-999999999999',
    '[{"name": "  ", "kind": "addon", "options": []}]'::jsonb);
  raise exception 'FAIL  a blank group name should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  a blank group name is refused';
end $$;
select public.assert(
  (select count(*) from public.modifier_groups where dish_id = :'DISH') = 0,
  'a refused save leaves nothing behind');
select public.assert(
  public.set_dish_modifiers(:'DISH', $j$[{"name": "Extras", "kind": "addon", "options": [{"name": "Egg", "price_cents": -50}]}]$j$::jsonb) = '{"groups": 1, "options": 1}'::jsonb,
  'a negative price is accepted');
select public.assert(
  (select price_cents from public.modifier_options where name = 'Egg') = 0,
  'a negative price is clamped to zero');

\echo ''
\echo '=== authorisation ==='
update public.test_flags set owns = false;
do $$
begin
  perform public.set_dish_modifiers('99999999-9999-9999-9999-999999999999', '[]'::jsonb);
  raise exception 'FAIL  a user without a manage role should be refused';
exception when insufficient_privilege then
  raise notice '  PASS  a user without a manage role is refused with 42501';
end $$;
select public.assert(
  (select count(*) from public.modifier_groups where dish_id = :'DISH') = 1,
  'the refused call changed nothing');
update public.test_flags set owns = true;
do $$
begin
  perform public.set_dish_modifiers('00000000-0000-0000-0000-000000000000', '[]'::jsonb);
  raise exception 'FAIL  an unknown dish should be refused';
exception when invalid_parameter_value then
  raise notice '  PASS  an unknown dish is refused';
end $$;

\echo ''
\echo 'ALL MODIFIER ASSERTIONS PASSED'
