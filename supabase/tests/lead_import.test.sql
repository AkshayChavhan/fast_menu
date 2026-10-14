-- Tests for import_leads_json() and set_lead_facts(), from
-- ../migrations/*_lead_import.sql. Run with ../../scripts/test-sql.sh.
--
-- What is pinned down: a file never duplicates a lead it already describes,
-- never overwrites what a caller typed, and unknown (NA → null) is never
-- turned into "no".

\pset tuples_only on
\pset format unaligned

insert into public.lead_cities (id, name, state, district, population, lat, lon, is_metro)
values ('Q9', 'Sangli', 'Maharashtra', 'Sangli', 500000, 16.85, 74.58, false)
on conflict (id) do nothing;

insert into public.platform_admins (email, role) values ('import@example.com', 'admin')
on conflict (email) do update set role = 'admin';
update public.test_auth set email = 'import@example.com';

-- A lead the caller already worked, with a phone they typed.
insert into public.leads (id, city_id, name, source, phone, status, pending, website_status, hard_menu)
values ('1ead1000-0000-0000-0000-000000000001', 'Q9', 'Hotel Krishna Bhavan', 'manual',
        '+91 93322 11111', 'reached', 'Send pricing', 'unknown', true);

\echo ''
\echo '=== import_leads_json() ==='

select public.import_leads_json('Q9', '[
  {"name": "Krishna Bhavan Restaurant", "phone": "09332211111",
   "google_rating": 4.2, "google_review_count": 310, "website_known": false,
   "digital_menu": false, "hard_menu": false, "on_zomato": true,
   "notes": "should not duplicate"},
  {"name": "Cafe Imported", "phone": "+91 93322 22222", "kind": "cafe",
   "website": "cafeimported.in", "google_rating": "3.9", "on_swiggy": null,
   "image_url": "https://img.example/cafe.jpg",
   "notes": "Imported with a note", "extra": {"color": "blue"}},
  {"name": "  ", "phone": "1"},
  {"name": "No Website Dhaba", "website_known": false, "digital_menu": null}
]'::jsonb) as r \gset

select public.assert((:'r'::jsonb ->> 'inserted') = '2' and (:'r'::jsonb ->> 'updated') = '1',
  'two inserted, one matched by phone and updated, the blank name skipped');

select public.assert(
  (select count(*) from public.leads where city_id = 'Q9' and public.normalize_hotel_name(name) = 'krishna bhavan') = 1,
  'the matched lead was not duplicated');
select public.assert(
  (select phone || '|' || status || '|' || pending from public.leads where id = '1ead1000-0000-0000-0000-000000000001')
    = '+91 93322 11111|reached|Send pricing',
  'phone, status and pending the caller typed survive');
select public.assert(
  (select google_rating::text || '|' || google_review_count from public.leads where id = '1ead1000-0000-0000-0000-000000000001')
    = '4.2|310',
  'the rating from the file lands on the matched lead');
select public.assert(
  (select hard_menu from public.leads where id = '1ead1000-0000-0000-0000-000000000001') = true,
  'a menu fact the caller recorded beats the file');
select public.assert(
  (select digital_menu from public.leads where id = '1ead1000-0000-0000-0000-000000000001') = false,
  'a menu fact nobody knew is filled from the file');
select public.assert(
  (select website_status from public.leads where id = '1ead1000-0000-0000-0000-000000000001') = 'none',
  'website_known false sets no website');
select public.assert(
  (select count(*) from public.lead_notes where lead_id = '1ead1000-0000-0000-0000-000000000001') = 0,
  'a file note is not added to a lead that already exists');

select public.assert(
  (select source || '|' || kind || '|' || website_status || '|' || google_rating::text || '|' || (extra ->> 'color')
     from public.leads where name = 'Cafe Imported') = 'import|cafe|has|3.9|blue',
  'a new lead carries source, kind, website, a string rating, and extra');
select public.assert(
  (select body from public.lead_notes n join public.leads l on l.id = n.lead_id where l.name = 'Cafe Imported')
    = 'Imported with a note',
  'a file note becomes the first call-log entry on a new lead');
select public.assert(
  (select on_swiggy is null and digital_menu is null from public.leads where name = 'Cafe Imported'),
  'NA stays unknown');
select public.assert(
  (select image_url from public.leads where name = 'Cafe Imported') = 'https://img.example/cafe.jpg',
  'a photo link from the file is kept');
select public.assert(
  (select website_status from public.leads where name = 'No Website Dhaba') = 'none',
  'no website is recorded as none when the file says so');

-- Re-import: nothing new, the newer rating wins, blanks fill.
select public.import_leads_json('Q9', '[
  {"name": "Cafe Imported", "google_rating": 4.1, "address": "Station Rd", "phone": "0000",
   "image_url": "https://img.example/cafe-new.jpg"}
]'::jsonb) as r2 \gset
select public.assert((:'r2'::jsonb ->> 'inserted') = '0' and (:'r2'::jsonb ->> 'updated') = '1',
  're-importing by name updates, never duplicates');
select public.assert(
  (select google_rating::text || '|' || address || '|' || phone from public.leads where name = 'Cafe Imported')
    = '4.1|Station Rd|+91 93322 22222',
  'the newer rating replaces, the address fills, the known phone stays');
select public.assert(
  (select image_url from public.leads where name = 'Cafe Imported') = 'https://img.example/cafe-new.jpg',
  'a newer photo link replaces the old one');

update public.test_auth set email = 'nobody@example.com';
do $$
begin
  perform public.import_leads_json('Q9', '[]'::jsonb);
  raise exception 'FAIL  a non-admin could import';
exception when insufficient_privilege then
  raise notice '  PASS  a non-admin is refused';
end $$;

\echo ''
\echo '=== set_lead_facts() ==='
update public.test_auth set email = 'import@example.com';
select public.set_lead_facts('1ead1000-0000-0000-0000-000000000001', p_digital_menu := true,
  p_digital_menu_provider := 'Zomato QR', p_verified := true);
select public.assert(
  (select digital_menu and verified and hard_menu and digital_menu_provider = 'Zomato QR'
     from public.leads where id = '1ead1000-0000-0000-0000-000000000001'),
  'answers are set, nulls leave the rest alone, and the lead is verified');
select public.set_lead_facts('1ead1000-0000-0000-0000-000000000001', p_hard_menu := false);
select public.assert(
  (select digital_menu and not hard_menu from public.leads where id = '1ead1000-0000-0000-0000-000000000001'),
  'a later answer changes one fact and keeps the others');

\echo ''
\echo '=== replace mode ==='
-- An admin may update; only the owner may wipe a city.
insert into public.platform_admins (email, role) values ('import@example.com', 'admin')
on conflict (email) do update set role = 'admin';
update public.test_auth set email = 'import@example.com';
do $$
begin
  perform public.import_leads_json('Q9', '[{"name": "X"}]'::jsonb, 'replace');
  raise exception 'FAIL  an admin could replace a list';
exception when insufficient_privilege then
  raise notice '  PASS  an admin cannot replace a list';
end $$;
select public.assert(
  (select count(*) from public.leads where city_id = 'Q9') = 3,
  'and nothing was removed by the refused call');

do $$
begin
  perform public.import_leads_json('Q9', '[]'::jsonb, 'sideways');
  raise exception 'FAIL  an unknown mode was accepted';
exception when invalid_parameter_value then
  raise notice '  PASS  an unknown mode is refused';
end $$;

update public.platform_admins set role = 'project_owner' where email = 'import@example.com';
select public.import_leads_json('Q9', '[
  {"name": "Brand New Cafe", "phone": "+91 93322 99999"},
  {"name": "Krishna Bhavan Restaurant", "phone": "09332211111"}
]'::jsonb, 'replace') as r3 \gset
select public.assert(
  (:'r3'::jsonb ->> 'removed') = '3' and (:'r3'::jsonb ->> 'inserted') = '2' and (:'r3'::jsonb ->> 'updated') = '0',
  'replace removes the three that were there and inserts the file as new');
select public.assert(
  (select count(*) from public.leads where city_id = 'Q9') = 2,
  'only the file remains');
select public.assert(
  not exists (select 1 from public.leads where id = '1ead1000-0000-0000-0000-000000000001'),
  'the lead the caller had worked is gone, as asked');
select public.assert(
  (select status || '|' || coalesce(pending, '-') from public.leads where name = 'Krishna Bhavan Restaurant') = 'new|-',
  'and its namesake from the file starts fresh');
select public.assert(
  (select count(*) from public.platform_audit
    where action = 'leads.replace' and target = 'Q9' and (details ->> 'removed') = '3'
      and actor = 'import@example.com') = 1,
  'the wipe is audited with the count');

delete from public.platform_admins where email = 'import@example.com';
update public.test_auth set email = null;
