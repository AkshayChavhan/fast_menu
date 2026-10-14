-- ============================================================================
-- Leads: restaurants we might sell to, and what happened when we called.
--
-- The list comes from two places. OpenStreetMap gives a free starting point
-- (thin in small towns, and it almost never records a website, so "no website"
-- on an OSM row means "not recorded", not "they have none"). The rest is
-- typed in by whoever is on the phone. Both land in the same table, and the
-- call log is what the page is really for: who was reached, what was said,
-- what is still pending, and when to go back.
--
-- Platform admins only. A lead is a stranger's business phone number, so it
-- never leaves the operator pages, and nothing here is visible to a
-- restaurant.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- lead_cities — the place picker: state → district → city, with population
-- for the size buckets. Rows come from *_lead_cities_seed.sql.
-- ---------------------------------------------------------------------------
create table if not exists public.lead_cities (
  id         text primary key,          -- Wikidata id, e.g. Q1156 for Mumbai
  name       text not null,
  state      text not null,
  district   text,
  population integer,                   -- latest on Wikidata; null = not recorded
  lat        double precision not null,
  lon        double precision not null,
  is_metro   boolean not null default false
);
create index if not exists lead_cities_state_district_idx
  on public.lead_cities (state, district, name);

alter table public.lead_cities enable row level security;
drop policy if exists "lead_cities_admin_read" on public.lead_cities;
create policy "lead_cities_admin_read" on public.lead_cities
  for select using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- leads — one restaurant we may call.
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  city_id        text not null references public.lead_cities (id),
  name           text not null,
  source         text not null check (source in ('osm', 'manual')),
  -- OpenStreetMap element, e.g. node/123456. Unique so a refetch updates in
  -- place instead of duplicating.
  osm_ref        text,
  phone          text,
  website        text,
  -- unknown: nothing recorded (every OSM row starts here).
  -- has:     a URL is known.
  -- none:    the caller asked, and they have no website.
  website_status text not null default 'unknown'
                 check (website_status in ('unknown', 'has', 'none')),
  address        text,
  cuisine        text,
  lat            double precision,
  lon            double precision,
  status         text not null default 'new'
                 check (status in ('new', 'reached', 'interested', 'demo_booked',
                                   'trial', 'won', 'not_interested')),
  -- Email of whoever is working this lead. Free text: callers are not
  -- necessarily platform admins with accounts.
  assigned_to    text,
  -- What still has to happen, in the caller's words. One field, overwritten
  -- each call, so the list shows the current to-do and not a history.
  pending        text,
  revisit_at     date,
  revisit_type   text check (revisit_type in ('call', 'online_meeting', 'demo')),
  -- Set when the lead turns out to already be a fast_menu restaurant, so
  -- nobody pitches a customer.
  restaurant_id  uuid references public.restaurants (id) on delete set null,
  -- Last OSM fetch that returned this element.
  last_seen_at   timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists leads_osm_ref_key
  on public.leads (osm_ref) where osm_ref is not null;
create index if not exists leads_city_idx on public.leads (city_id, status);
create index if not exists leads_revisit_idx
  on public.leads (revisit_at) where revisit_at is not null;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

alter table public.leads enable row level security;
drop policy if exists "leads_admin_all" on public.leads;
create policy "leads_admin_all" on public.leads
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- lead_notes — the call log. Append only; the lead's status and pending
-- field carry the current state, these carry what was said and when.
-- ---------------------------------------------------------------------------
create table if not exists public.lead_notes (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads (id) on delete cascade,
  author     text,                       -- email of the signed-in admin
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);

alter table public.lead_notes enable row level security;
drop policy if exists "lead_notes_admin_all" on public.lead_notes;
create policy "lead_notes_admin_all" on public.lead_notes
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- match_lead_restaurant() — is this lead already a customer?
-- By phone first (last ten digits, so +91 and 0 prefixes don't matter), then
-- by normalised name in the same city. Null when nothing matches.
-- ---------------------------------------------------------------------------
create or replace function public.match_lead_restaurant(
  p_name text, p_phone text, p_city text
) returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  norm   text := public.normalize_hotel_name(p_name);
  rid    uuid;
begin
  if length(digits) = 10 then
    select r.id into rid from public.restaurants r
    where right(regexp_replace(coalesce(r.phone, ''), '\D', '', 'g'), 10) = digits
    limit 1;
    if rid is not null then return rid; end if;
  end if;

  if norm is not null and p_city is not null then
    select r.id into rid from public.restaurants r
    where public.normalize_hotel_name(r.name) = norm
      and lower(trim(r.city)) = lower(trim(p_city))
    limit 1;
  end if;
  return rid;
end;
$$;

-- ---------------------------------------------------------------------------
-- import_osm_leads() — upsert a batch fetched from Overpass for one city.
-- p_rows: [{osm_ref, name, phone, website, address, cuisine, lat, lon}, ...]
-- A row already in the table keeps everything the caller may have typed
-- (phone, website, status, notes); only blanks are filled in from OSM.
-- Returns how many rows were new.
-- ---------------------------------------------------------------------------
create or replace function public.import_osm_leads(p_city_id text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  city_name text;
  inserted  integer;
begin
  if not public.is_platform_admin() then
    raise exception 'not a platform admin' using errcode = '42501';
  end if;
  select c.name into city_name from public.lead_cities c where c.id = p_city_id;
  if city_name is null then
    raise exception 'unknown city %', p_city_id using errcode = '22023';
  end if;

  with incoming as (
    select
      r ->> 'osm_ref'                 as osm_ref,
      nullif(trim(r ->> 'name'), '')  as name,
      nullif(trim(r ->> 'phone'), '') as phone,
      nullif(trim(r ->> 'website'), '') as website,
      nullif(trim(r ->> 'address'), '') as address,
      nullif(trim(r ->> 'cuisine'), '') as cuisine,
      (r ->> 'lat')::double precision as lat,
      (r ->> 'lon')::double precision as lon
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where r ->> 'osm_ref' is not null and nullif(trim(r ->> 'name'), '') is not null
  ),
  upserted as (
    insert into public.leads
      (city_id, name, source, osm_ref, phone, website, website_status,
       address, cuisine, lat, lon, restaurant_id, last_seen_at, created_by)
    select
      p_city_id, i.name, 'osm', i.osm_ref, i.phone, i.website,
      case when i.website is not null then 'has' else 'unknown' end,
      i.address, i.cuisine, i.lat, i.lon,
      public.match_lead_restaurant(i.name, i.phone, city_name),
      now(), auth.uid()
    from incoming i
    on conflict (osm_ref) where osm_ref is not null do update set
      phone          = coalesce(public.leads.phone, excluded.phone),
      website        = coalesce(public.leads.website, excluded.website),
      website_status = case
                         when public.leads.website_status = 'unknown'
                          and excluded.website is not null then 'has'
                         else public.leads.website_status
                       end,
      address        = coalesce(public.leads.address, excluded.address),
      cuisine        = coalesce(public.leads.cuisine, excluded.cuisine),
      lat            = coalesce(public.leads.lat, excluded.lat),
      lon            = coalesce(public.leads.lon, excluded.lon),
      last_seen_at   = now()
    returning (xmax = 0) as is_new
  )
  select count(*) filter (where is_new) into inserted from upserted;
  return coalesce(inserted, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_lead() — a restaurant the caller found some other way.
-- Returns the new id.
-- ---------------------------------------------------------------------------
create or replace function public.create_lead(
  p_city_id text, p_name text, p_phone text, p_website text, p_address text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  city_name text;
  lid       uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'not a platform admin' using errcode = '42501';
  end if;
  select c.name into city_name from public.lead_cities c where c.id = p_city_id;
  if city_name is null then
    raise exception 'unknown city %', p_city_id using errcode = '22023';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'name is required' using errcode = '22023';
  end if;

  insert into public.leads
    (city_id, name, source, phone, website, website_status, address,
     restaurant_id, created_by)
  values
    (p_city_id, trim(p_name), 'manual',
     nullif(trim(p_phone), ''), nullif(trim(p_website), ''),
     case when nullif(trim(p_website), '') is not null then 'has' else 'unknown' end,
     nullif(trim(p_address), ''),
     public.match_lead_restaurant(p_name, p_phone, city_name),
     auth.uid())
  returning id into lid;
  return lid;
end;
$$;

-- ---------------------------------------------------------------------------
-- list_lead_states() — the first step of the picker. The API caps a query
-- at a thousand rows and the seed is nearly three thousand, so the page
-- loads states first and then one state's cities at a time.
-- ---------------------------------------------------------------------------
create or replace function public.list_lead_states()
returns table (state text, city_count integer, lead_count integer)
language sql stable security definer set search_path = public as $$
  select c.state, count(distinct c.id)::int, count(l.id)::int
  from public.lead_cities c
  left join public.leads l on l.city_id = c.id
  where public.is_platform_admin()
  group by c.state
  order by c.state
$$;
