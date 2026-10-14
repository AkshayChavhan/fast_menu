-- Tests for lead_geo_summary(), from ../migrations/*_lead_geo_summary.sql.
-- Run with ../../scripts/test-sql.sh. Who may call it is a grant, which the
-- harness does not model; what it returns is checked here.

\pset tuples_only on
\pset format unaligned

insert into public.lead_cities (id, name, state, district, population, lat, lon, is_metro) values
  ('G1', 'Geo One', 'Geostate', 'D', 1000, 20, 73, false),
  ('G2', 'Geo Two', 'Geostate', 'D', 2000, 20, 73, false)
on conflict (id) do nothing;
insert into public.leads (city_id, name, source) values ('G1', 'Geo Lead A', 'manual'), ('G1', 'Geo Lead B', 'manual');

select public.lead_geo_summary() as g \gset

\echo ''
\echo '=== lead_geo_summary() ==='
select public.assert(
  (select s ->> 'city_count' from jsonb_array_elements(:'g'::jsonb -> 'states') s where s ->> 'state' = 'Geostate') = '2',
  'cities are counted per state');
select public.assert(
  (select s ->> 'lead_count' from jsonb_array_elements(:'g'::jsonb -> 'states') s where s ->> 'state' = 'Geostate') = '2',
  'and leads are counted per state');
select public.assert(
  (:'g'::jsonb ->> 'generated_at') is not null,
  'the summary says when it was made');
