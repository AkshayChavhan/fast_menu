-- Tests for public.import_menu(uuid, jsonb) from ../schema.sql.
-- Run with ../../scripts/test-sql.sh.

-- assert() returns void and reports through RAISE NOTICE, so silence the
-- empty result rows that every `select public.assert(...)` would print.
\pset tuples_only on
\pset format unaligned

\set R  '11111111-1111-1111-1111-111111111111'
\set R2 '22222222-2222-2222-2222-222222222222'

\echo ''
\echo '=== setup: an existing menu, plus a second tenant that must not be touched ==='
insert into public.categories (restaurant_id, name) values (:'R', 'OLD CATEGORY');
insert into public.dishes (restaurant_id, name) values (:'R', 'OLD DISH A'), (:'R', 'OLD DISH B');
insert into public.categories (restaurant_id, name) values (:'R2', 'OTHER TENANT CAT');
insert into public.dishes (restaurant_id, name) values (:'R2', 'OTHER TENANT DISH');

\echo ''
\echo '=== import replaces the menu ==='
select public.assert(
  public.import_menu(:'R', $json$
  {
    "categories": [
      {"name": "Starters", "name_i18n": {"hi": "स्टार्टर"}, "description": "Small plates",
       "dishes": [
         {"name": "Paneer Tikka", "name_i18n": {"hi": "पनीर टिक्का"},
          "description": "Grilled", "description_i18n": {"hi": "तंदूरी"},
          "price_cents": 32000, "image_url": "https://ex.com/a.png",
          "allergens": ["dairy"], "dietary_tags": ["vegetarian", "chef-special"],
          "is_available": false, "is_featured": true},
         {"name": "Chicken 65", "price_cents": 38000}
       ]},
      {"name": "Mains", "dishes": [{"name": "Dal Makhani", "price_cents": 34000}]}
    ],
    "dishes": [{"name": "Masala Chai", "price_cents": 9000, "image_url": ""}]
  }
  $json$::jsonb) = '{"dishes": 4, "categories": 2}'::jsonb,
  'returns the inserted counts');

select public.assert(
  (select count(*) from public.categories where restaurant_id = :'R') = 2
  and (select count(*) from public.dishes where restaurant_id = :'R') = 4,
  'menu now holds exactly what the payload described');

select public.assert(
  not exists (select 1 from public.categories where restaurant_id = :'R' and name like 'OLD%')
  and not exists (select 1 from public.dishes where restaurant_id = :'R' and name like 'OLD%'),
  'previous menu was deleted');

select public.assert(
  (select count(*) from public.categories where restaurant_id = :'R2') = 1
  and (select count(*) from public.dishes where restaurant_id = :'R2') = 1,
  'another restaurant is left alone');

\echo ''
\echo '=== field fidelity ==='
select public.assert(
  name_i18n ->> 'hi' = 'पनीर टिक्का'
  and description_i18n ->> 'hi' = 'तंदूरी'
  and price_cents = 32000
  and image_url = 'https://ex.com/a.png'
  and allergens = array['dairy']
  and dietary_tags = array['vegetarian', 'chef-special']
  and is_available = false
  and is_featured = true,
  'every dish column round-trips out of jsonb')
from public.dishes where name = 'Paneer Tikka';

select public.assert(
  (select count(*) from public.dishes where allergens = array[]::text[] and name = 'Chicken 65') = 1,
  'a dish with no allergens key gets an empty array, not null');

\echo ''
\echo '=== ordering and linkage ==='
select public.assert(
  (select sort_order from public.categories where name = 'Starters') = 0
  and (select sort_order from public.categories where name = 'Mains') = 1,
  'categories keep their payload order');

select public.assert(
  (select sort_order from public.dishes where name = 'Paneer Tikka') = 0
  and (select sort_order from public.dishes where name = 'Chicken 65') = 1,
  'dishes keep their order within a category');

select public.assert(
  (select d.category_id from public.dishes d where d.name = 'Dal Makhani')
  = (select c.id from public.categories c where c.name = 'Mains'),
  'dishes attach to the category they were nested under');

select public.assert(
  (select category_id is null and image_url is null
   from public.dishes where name = 'Masala Chai'),
  'top-level dishes stay uncategorised, and an empty image_url becomes null');

\echo ''
\echo '=== ownership guard ==='
update public.test_flags set owns = false;
do $$
begin
  perform public.import_menu('11111111-1111-1111-1111-111111111111',
                             '{"categories":[{"name":"HACKED","dishes":[]}]}'::jsonb);
  raise exception 'FAIL  import_menu ran for a non-owner';
exception
  when insufficient_privilege then
    raise notice '  PASS  a non-owner is refused with 42501';
end
$$;
update public.test_flags set owns = true;

select public.assert(
  not exists (select 1 from public.categories where name = 'HACKED')
  and (select count(*) from public.categories where restaurant_id = :'R') = 2,
  'the refused import changed nothing');

\echo ''
\echo '=== atomicity ==='
do $$
declare
  before_cats int;
  before_dishes int;
begin
  select count(*) into before_cats from public.categories
    where restaurant_id = '11111111-1111-1111-1111-111111111111';
  select count(*) into before_dishes from public.dishes
    where restaurant_id = '11111111-1111-1111-1111-111111111111';

  begin
    -- The second category has no name. The failure lands *after* the deletes
    -- and the first insert have already been applied, so this only passes if
    -- the whole function rolls back.
    perform public.import_menu('11111111-1111-1111-1111-111111111111', $j$
      {"categories":[
        {"name":"Replacement A","dishes":[{"name":"New dish","price_cents":100}]},
        {"description":"no name","dishes":[]}
      ]}
    $j$::jsonb);
    raise exception 'FAIL  a malformed payload was accepted';
  exception
    when not_null_violation then
      null; -- expected
  end;

  perform public.assert(
    (select count(*) from public.categories
       where restaurant_id = '11111111-1111-1111-1111-111111111111') = before_cats
    and (select count(*) from public.dishes
       where restaurant_id = '11111111-1111-1111-1111-111111111111') = before_dishes,
    'a failure mid-import rolls the deletes back');

  perform public.assert(
    not exists (select 1 from public.categories where name = 'Replacement A'),
    'no partial rows survive the failed import');
end
$$;

\echo ''
\echo '=== empty-ish payloads ==='
select public.assert(
  public.import_menu(:'R', '{"categories":[],"dishes":[{"name":"Only one","price_cents":1}]}'::jsonb)
    = '{"dishes": 1, "categories": 0}'::jsonb,
  'a payload of only uncategorised dishes is accepted');

\echo ''
\echo 'ALL SQL ASSERTIONS PASSED'
