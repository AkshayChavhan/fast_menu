-- Tests for public.import_menu(uuid, jsonb) from ../migrations/.
-- Run with ../../scripts/test-sql.sh.

-- assert() returns void and reports through RAISE NOTICE, so silence the
-- empty result rows that every `select public.assert(...)` would print.
\pset tuples_only on
\pset format unaligned

\set R  '11111111-1111-1111-1111-111111111111'
\set R2 '22222222-2222-2222-2222-222222222222'

\echo ''
\echo '=== setup: an existing menu, plus a second tenant that must not be touched ==='
insert into public.restaurants (id, owner_id, name, slug) values (:'R', :'R', 'Import Test', 'import-test');
insert into public.menu_schedules (restaurant_id, name, starts_at, ends_at) values (:'R', 'Morning', '07:00', '11:00');
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
      {"name": "Mains", "schedule": "morning",
       "dishes": [{"name": "Dal Makhani", "price_cents": 34000,
                   "special_from": "2026-09-21", "special_until": "2026-09-27",
                   "modifiers": [{"name": "Portion", "kind": "variant",
                                  "options": [{"name": "Half", "price_cents": 20000, "is_default": true},
                                              {"name": "Full", "price_cents": 34000}]}]}]},
      {"name": "Dinner", "schedule": "No such schedule", "dishes": []}
    ],
    "dishes": [{"name": "Masala Chai", "price_cents": 9000, "image_url": ""}]
  }
  $json$::jsonb) = '{"dishes": 4, "categories": 3, "schedules": 0}'::jsonb,
  'returns the inserted counts');

select public.assert(
  (select count(*) from public.categories where restaurant_id = :'R') = 3
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
\echo '=== schedules, specials and modifiers ==='
select public.assert(
  (select s.name from public.categories c join public.menu_schedules s on s.id = c.schedule_id where c.name = 'Mains') = 'Morning',
  'a category schedule resolves by name, case-insensitively');
select public.assert(
  (select schedule_id is null from public.categories where name = 'Dinner'),
  'an unknown schedule name leaves the category unscheduled');
select public.assert(
  (select special_from = '2026-09-21' and special_until = '2026-09-27' from public.dishes where name = 'Dal Makhani'),
  'special dates land on the dish');
select public.assert(
  (select special_from is null and special_until is null from public.dishes where name = 'Paneer Tikka'),
  'dishes without dates stay ordinary');
select public.assert(
  (select count(*) from public.modifier_groups g join public.dishes d on d.id = g.dish_id where d.name = 'Dal Makhani') = 1
  and (select array_agg(o.name order by o.sort_order)
         from public.modifier_options o
         join public.modifier_groups g on g.id = o.group_id
         join public.dishes d on d.id = g.dish_id
        where d.name = 'Dal Makhani') = array['Half', 'Full'],
  'modifier groups and options are imported with the dish');
select public.assert(
  (select is_default from public.modifier_options where name = 'Half') = true,
  'the default variant is kept');


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
  and (select count(*) from public.categories where restaurant_id = :'R') = 3,
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
    = '{"dishes": 1, "categories": 0, "schedules": 0}'::jsonb,
  'a payload of only uncategorised dishes is accepted');

\echo ''
\echo '=== settings block ==='

-- A file with no settings must leave the restaurant exactly as it was: this is
-- what keeps menu files written before settings existed importing unchanged.
update public.restaurants
   set currency = 'USD', timezone = 'UTC', default_locale = 'en',
       locales = array['en'], ordering_enabled = false, kds_enabled = false,
       google_review_url = 'https://old.example/review'
 where id = :'R';

select public.import_menu(:'R',
  '{"categories":[],"dishes":[{"name":"Plain","price_cents":1}]}'::jsonb);

select public.assert(
  (select currency = 'USD' and timezone = 'UTC' and default_locale = 'en'
      and google_review_url = 'https://old.example/review'
   from public.restaurants where id = :'R'),
  'a file with no settings leaves the restaurant untouched');

select public.import_menu(:'R', $json$
  {
    "settings": {
      "currency": "INR",
      "timezone": "Asia/Kolkata",
      "default_locale": "hi",
      "locales": ["en", "hi"],
      "ordering_enabled": true,
      "kds_enabled": true,
      "google_review_url": null
    },
    "dishes": [{"name": "After settings", "price_cents": 100}]
  }
  $json$::jsonb);

select public.assert(
  (select currency = 'INR' and timezone = 'Asia/Kolkata'
      and default_locale = 'hi' and locales = array['en','hi']
      and ordering_enabled and kds_enabled
      and google_review_url is null
   from public.restaurants where id = :'R'),
  'settings are applied, and an explicit null clears the review link');

-- Only the keys present are touched, so a partial block is a partial update.
select public.import_menu(:'R',
  '{"settings":{"currency":"AED"},"dishes":[{"name":"Partial","price_cents":1}]}'::jsonb);

select public.assert(
  (select currency = 'AED' and timezone = 'Asia/Kolkata' and default_locale = 'hi'
   from public.restaurants where id = :'R'),
  'a partial settings block leaves the other settings alone');

-- The allowlist is the security boundary: an uploaded file must not be able to
-- move the public URL, publish the menu, or hand itself someone else's trial.
select public.import_menu(:'R', $json$
  {
    "settings": {"slug": "stolen", "is_published": true,
                 "trial_status": "active", "owner_id": "00000000-0000-0000-0000-000000000009"},
    "dishes": [{"name": "Sneaky", "price_cents": 1}]
  }
  $json$::jsonb);

select public.assert(
  (select slug <> 'stolen' and not is_published and trial_status <> 'active'
   from public.restaurants where id = :'R'),
  'settings cannot change slug, publish state, trial or ownership');

select public.assert(
  (select locales = array['en','hi'] from public.restaurants where id = :'R'),
  'an omitted locales key does not empty the language list');

\echo ''
\echo '=== schedule definitions ==='

delete from public.menu_schedules where restaurant_id = :'R';

select public.assert(
  public.import_menu(:'R', $json$
    {
      "schedules": [
        {"name": "Lunch", "days": [1,2,3,4,5], "starts_at": "12:00:00", "ends_at": "15:30:00", "is_active": true},
        {"name": "Late", "days": [5,6], "starts_at": "22:00:00", "ends_at": "02:00:00", "is_active": false}
      ],
      "categories": [{"name": "Thalis", "schedule": "Lunch", "dishes": []}],
      "dishes": [{"name": "Chai", "price_cents": 100}]
    }
    $json$::jsonb) = '{"dishes": 1, "categories": 1, "schedules": 2}'::jsonb,
  'schedules are reported in the counts');

select public.assert(
  (select count(*) from public.menu_schedules where restaurant_id = :'R') = 2,
  'schedules in the file are created');

select public.assert(
  (select days = array[1,2,3,4,5]::smallint[] and starts_at = '12:00'::time
      and ends_at = '15:30'::time and is_active
   from public.menu_schedules where restaurant_id = :'R' and name = 'Lunch'),
  'a schedule keeps its days, times and active flag');

select public.assert(
  (select ends_at < starts_at and not is_active
   from public.menu_schedules where restaurant_id = :'R' and name = 'Late'),
  'an overnight window survives, and inactive stays inactive');

-- The point of the whole change: a category links to a schedule defined in the
-- same file, which previously had to already exist.
select public.assert(
  (select s.name from public.categories c
     join public.menu_schedules s on s.id = c.schedule_id
    where c.restaurant_id = :'R' and c.name = 'Thalis') = 'Lunch',
  'a category links to a schedule created by the same import');

-- Re-importing the same file must update in place, not pile up duplicates.
select public.import_menu(:'R', $json$
  {
    "schedules": [{"name": "lunch", "days": [0], "starts_at": "09:00:00", "ends_at": "10:00:00", "is_active": true}],
    "dishes": [{"name": "Chai", "price_cents": 100}]
  }
  $json$::jsonb);

select public.assert(
  (select count(*) from public.menu_schedules where restaurant_id = :'R') = 2
  and (select days = array[0]::smallint[] and starts_at = '09:00'::time
       from public.menu_schedules where restaurant_id = :'R' and name = 'Lunch'),
  'a schedule is matched by name case-insensitively and updated, not duplicated');

-- Later test files create their own restaurants; leave no rows behind.
delete from public.restaurants where id = :'R';

\echo ''
\echo 'ALL SQL ASSERTIONS PASSED'
