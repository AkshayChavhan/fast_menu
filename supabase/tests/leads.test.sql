-- Tests for match_lead_restaurant(), import_osm_leads() and create_lead(),
-- from ../migrations/*_leads.sql. Run with ../../scripts/test-sql.sh.
--
-- What matters: a refetch from OpenStreetMap must never overwrite what a
-- caller typed, a lead that is already a customer must say so, and nobody
-- outside platform_admins gets to write.

\pset tuples_only on
\pset format unaligned

\set CUST '1ead0000-0000-0000-0000-000000000001'
\set OWNER '1ead0000-0000-0000-0000-0000000000aa'

insert into public.lead_cities (id, name, state, district, population, lat, lon, is_metro)
values ('Q1', 'Nashik', 'Maharashtra', 'Nashik', 1486000, 19.9975, 73.7898, false);

insert into public.restaurants (id, owner_id, name, slug, city, phone)
values (:'CUST', :'OWNER', 'Hotel Leadtest Bhavan', 'sai-palace', 'Nashik', '+91 93311 22334');

\echo ''
\echo '=== match_lead_restaurant() ==='

select public.assert(
  public.match_lead_restaurant('Anything', '09331122334', 'Pune') = :'CUST',
  'a phone matches on its last ten digits whatever the prefix');
select public.assert(
  public.match_lead_restaurant('Leadtest Bhavan Restaurant', null, 'nashik') = :'CUST',
  'a normalised name in the same city matches without a phone');
select public.assert(
  public.match_lead_restaurant('Leadtest Bhavan Restaurant', null, 'Pune') is null,
  'the same name in another city is not a match');
select public.assert(
  public.match_lead_restaurant('Unrelated Dhaba', '1234567890', 'Nashik') is null,
  'nothing matches, null');

\echo ''
\echo '=== import_osm_leads() ==='

update public.test_auth set email = 'nobody@example.com';
do $$
begin
  perform public.import_osm_leads('Q1', '[]'::jsonb);
  raise exception 'FAIL  a non-admin could import leads';
exception when insufficient_privilege then
  raise notice '  PASS  a non-admin is refused with 42501';
end $$;

insert into public.platform_admins (email) values ('ops@example.com');
update public.test_auth set email = 'ops@example.com';

select public.assert(
  public.import_osm_leads('Q1', '[
    {"osm_ref": "node/1", "name": "Leadtest Bhavan Restaurant", "phone": null, "website": null,
     "address": "College Rd", "cuisine": "indian", "lat": 19.99, "lon": 73.79},
    {"osm_ref": "node/2", "name": "Cafe Nashik", "phone": "+91 91111 11111",
     "website": "https://cafenashik.in", "lat": 20.0, "lon": 73.8},
    {"osm_ref": "node/3", "name": "   ", "lat": 20.0, "lon": 73.8}
  ]'::jsonb) = 2,
  'two named rows import; a blank name is skipped');

select public.assert(
  (select restaurant_id from public.leads where osm_ref = 'node/1') = :'CUST',
  'an imported lead that is already a customer is linked to it');
select public.assert(
  (select website_status from public.leads where osm_ref = 'node/2') = 'has',
  'a website tag reads as has');
select public.assert(
  (select website_status from public.leads where osm_ref = 'node/1') = 'unknown',
  'no website tag reads as unknown, not none');

-- The caller fills in a phone and marks them reached; a refetch must keep it.
update public.leads
   set phone = '+91 92222 22222', status = 'reached', pending = 'Send pricing'
 where osm_ref = 'node/1';

select public.assert(
  public.import_osm_leads('Q1', '[
    {"osm_ref": "node/1", "name": "Leadtest Bhavan Restaurant", "phone": "+91 00000 00000",
     "website": "https://saipalace.example", "lat": 19.99, "lon": 73.79}
  ]'::jsonb) = 0,
  'refetching an existing element counts as nothing new');
select public.assert(
  (select phone from public.leads where osm_ref = 'node/1') = '+91 92222 22222',
  'a phone typed by the caller survives a refetch');
select public.assert(
  (select status from public.leads where osm_ref = 'node/1') = 'reached'
  and (select pending from public.leads where osm_ref = 'node/1') = 'Send pricing',
  'status and pending survive a refetch');
select public.assert(
  (select website from public.leads where osm_ref = 'node/1') = 'https://saipalace.example'
  and (select website_status from public.leads where osm_ref = 'node/1') = 'has',
  'a website that was blank is filled in from the refetch');
select public.assert(
  (select count(*) from public.leads where city_id = 'Q1') = 2,
  'no duplicates after the refetch');

do $$
begin
  perform public.import_osm_leads('Q999', '[]'::jsonb);
  raise exception 'FAIL  an unknown city was accepted';
exception when invalid_parameter_value then
  raise notice '  PASS  an unknown city is refused';
end $$;

\echo ''
\echo '=== create_lead() ==='

-- Captured first: a row inserted by a volatile function is not visible to
-- the statement that called it.
select public.create_lead('Q1', '  Gokul Dhaba ', '', '', 'Mumbai Naka') as manual_id \gset
select public.assert(
  (select source || '|' || name from public.leads where id = :'manual_id') = 'manual|Gokul Dhaba',
  'a manual lead is created with its name trimmed');
select public.create_lead('Q1', 'Leadtest Bhavan', '9331122334', null, null) as cust_lead_id \gset
select public.assert(
  (select restaurant_id from public.leads where id = :'cust_lead_id') = :'CUST',
  'a manual lead whose phone is a customer is linked to it');

do $$
begin
  perform public.create_lead('Q1', '   ', null, null, null);
  raise exception 'FAIL  a blank name was accepted';
exception when invalid_parameter_value then
  raise notice '  PASS  a blank name is refused';
end $$;

update public.test_auth set email = 'nobody@example.com';
do $$
begin
  perform public.create_lead('Q1', 'Sneaky', null, null, null);
  raise exception 'FAIL  a non-admin could create a lead';
exception when insufficient_privilege then
  raise notice '  PASS  a non-admin cannot create a lead';
end $$;

delete from public.platform_admins where email = 'ops@example.com';
update public.test_auth set email = null;
