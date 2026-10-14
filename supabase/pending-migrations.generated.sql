-- fast_menu — migrations pending on the hosted database, in order.
-- Generated 2026-10-12 10:36.
--
-- Everything through 20260924003100 is already applied (verified by
-- probing the database: restaurant_plan, restaurant_is_live and
-- apply_paid_term all answer, and the payments table exists).
--
-- The first two are what /admin and /dashboard/insights need; without them
-- both pages throw on load. The next two (added 2026-10-14) are what
-- /admin/leads needs: the lead tables and the list of Indian cities. The
-- next (same day) adds the project-owner level: whoever is already in
-- platform_admins becomes the owner; /admin/payments and /admin/admins
-- 404 for everyone else. The next adds the JSON import on the leads page
-- and the columns it fills (Google rating, menu facts). The last lets an
-- import replace a city's list instead of updating it (owner only, audited).
--
-- Paste the whole file into the Supabase SQL editor and Run.

-- ============================================================
-- 20260924003200_admin_activity.sql
-- ============================================================
-- ============================================================================
-- Platform-admin view of who is actually using the product.
--
-- list_restaurant_plans() answers "what are they paying for". This answers the
-- question sales asks next: is the restaurant set up, and is anyone ordering.
-- One row per restaurant, with the raw facts — counts and timestamps — and no
-- verdicts. "Active", "quiet" and "at risk" are decided in lib/admin-activity.ts
-- so the thresholds can be tuned and unit-tested without a migration.
--
-- Orders are counted, never summed. A restaurant's takings are its own
-- business; an order count is enough to tell a busy floor from a dead one.
-- The only money here is what the restaurant paid us.
-- ============================================================================

create or replace function public.list_restaurant_activity()
returns table (
  restaurant_id         uuid,
  name                  text,
  slug                  text,
  city                  text,
  phone                 text,
  owner_email           text,
  created_at            timestamptz,
  plan                  text,
  plan_expires_at       timestamptz,
  effective_plan        text,
  is_live               boolean,
  is_published          boolean,
  trial_status          text,
  trial_ends_at         timestamptz,
  ordering_enabled      boolean,
  kds_enabled           boolean,
  has_review_link       boolean,
  dish_count            int,
  dish_photo_count      int,
  table_count           int,
  staff_count           int,
  last_menu_edit_at     timestamptz,
  orders_7d             int,
  orders_prev_7d        int,
  orders_30d            int,
  guest_orders_30d      int,
  last_order_at         timestamptz,
  last_payment_status   text,
  last_payment_at       timestamptz,
  paid_this_month_paise bigint
)
language sql security definer stable set search_path = public as $$
  select
    r.id, r.name, r.slug, r.city, r.phone, u.email::text, r.created_at,
    r.plan, r.plan_expires_at,
    public.restaurant_plan(r.id),
    public.restaurant_is_live(r.id),
    r.is_published, r.trial_status, r.trial_ends_at,
    r.ordering_enabled, r.kds_enabled,
    coalesce(r.google_review_url, '') <> '',
    d.dish_count, d.dish_photo_count, t.table_count, s.staff_count,
    d.last_menu_edit_at,
    o.orders_7d, o.orders_prev_7d, o.orders_30d, o.guest_orders_30d,
    o.last_order_at,
    lp.status, lp.created_at,
    pm.paid_this_month_paise
  from public.restaurants r
  -- Left join: a restaurant must not vanish from the operator's view because
  -- its owner row is unreadable.
  left join auth.users u on u.id = r.owner_id
  left join lateral (
    select count(*)::int as dish_count,
           count(*) filter (where coalesce(x.image_url, '') <> '')::int as dish_photo_count,
           max(greatest(x.created_at, x.updated_at)) as last_menu_edit_at
      from public.dishes x
     where x.restaurant_id = r.id
  ) d on true
  left join lateral (
    select count(*)::int as table_count
      from public.tables x
     where x.restaurant_id = r.id and x.is_active
  ) t on true
  left join lateral (
    select count(*)::int as staff_count
      from public.restaurant_staff x
     where x.restaurant_id = r.id and x.is_active
  ) s on true
  -- Only orders a member of staff accepted. A placed order nobody approved is
  -- a guest tapping a button, not the restaurant using the product.
  left join lateral (
    select count(*) filter (where x.created_at > now() - interval '7 days')::int as orders_7d,
           count(*) filter (where x.created_at <= now() - interval '7 days'
                              and x.created_at > now() - interval '14 days')::int as orders_prev_7d,
           count(*) filter (where x.created_at > now() - interval '30 days')::int as orders_30d,
           count(*) filter (where x.created_at > now() - interval '30 days'
                              and x.source = 'customer')::int as guest_orders_30d,
           max(x.created_at) as last_order_at
      from public.orders x
     where x.restaurant_id = r.id
       and x.status in ('approved', 'settled')
  ) o on true
  left join lateral (
    select x.status, x.created_at
      from public.payments x
     where x.restaurant_id = r.id
     order by x.created_at desc
     limit 1
  ) lp on true
  -- "This month" by the Indian calendar, which is where the invoices are.
  left join lateral (
    select coalesce(sum(x.amount_paise), 0)::bigint as paid_this_month_paise
      from public.payments x
     where x.restaurant_id = r.id
       and x.status = 'paid'
       and x.paid_at >= date_trunc('month', now() at time zone 'Asia/Kolkata')
                        at time zone 'Asia/Kolkata'
  ) pm on true
  where public.is_platform_admin()
  order by r.created_at desc
$$;

revoke all on function public.list_restaurant_activity() from public, anon;
grant execute on function public.list_restaurant_activity() to authenticated;


-- ============================================================
-- 20260924003300_restaurant_insights.sql
-- ============================================================
-- ============================================================================
-- Insights: what a restaurant's own orders say about its last thirty days.
--
-- The billing counter answers "what is open, and what did we take today".
-- This answers what an owner asks at the end of the week: is it better than
-- last week, when are we busy, what sells and what does not.
--
-- One function, one round trip, one jsonb document. Everything is bucketed by
-- the restaurant's own calendar — a bill settled at 00:30 belongs to the day it
-- is on the wall clock there, the same rule the billing counter uses for
-- "today" — and done here rather than in the page, because a busy restaurant
-- has more order lines in a month than a page should fetch to count them.
--
-- "Sales" are settled bills by the day they were paid. "Orders" are orders a
-- member of staff accepted, by the time they were placed. A placed order
-- nobody approved, a rejected one and a cancelled one are not business.
--
-- Read by the roles that hold reports:view in lib/permissions.ts.
-- ============================================================================

create or replace function public.restaurant_insights(rid uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  tz        text;
  today     date;
  since     timestamptz;  -- local midnight thirty days back, today included
  since_4w  timestamptz;  -- four whole weeks, so every weekday is counted four times
  result    jsonb;
begin
  if not public.has_role(rid, array['owner', 'manager', 'cashier']) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;

  -- A zone Postgres does not know would raise on every line below. Settings
  -- validates it, but a bad value should cost the owner an offset, not the page.
  select coalesce((select n.name from pg_timezone_names n where n.name = r.timezone), 'UTC')
    into tz
    from public.restaurants r
   where r.id = rid;
  if tz is null then
    raise exception 'Unknown restaurant %', rid using errcode = '22023';
  end if;

  today    := (now() at time zone tz)::date;
  since    := (today - 29)::timestamp at time zone tz;
  since_4w := (today - 27)::timestamp at time zone tz;

  select jsonb_build_object(
    'timezone', tz,
    'today', today,

    -- Thirty rows, oldest first, with zeros for the days nothing happened: a
    -- closed Monday is a fact about the restaurant, not a gap in the data.
    'days', (
      select jsonb_agg(jsonb_build_object(
               'date', d.day,
               'sales_cents', coalesce(s.sales_cents, 0),
               'bills', coalesce(s.bills, 0),
               'orders', coalesce(o.orders, 0)
             ) order by d.day)
        from (select today - n as day from generate_series(0, 29) as n) d
        left join (
          select (x.closed_at at time zone tz)::date as day,
                 sum(x.total_cents)::bigint as sales_cents,
                 count(*)::int as bills
            from public.table_sessions x
           where x.restaurant_id = rid and x.status = 'closed' and x.closed_at >= since
           group by 1
        ) s on s.day = d.day
        left join (
          select (x.created_at at time zone tz)::date as day, count(*)::int as orders
            from public.orders x
           where x.restaurant_id = rid and x.status in ('approved', 'settled')
             and x.created_at >= since
           group by 1
        ) o on o.day = d.day
    ),

    -- Orders by the hour they were placed, 0 to 23, over the thirty days.
    'hours', (
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'orders', coalesce(o.orders, 0))
                       order by h.hour)
        from generate_series(0, 23) as h(hour)
        left join (
          select extract(hour from x.created_at at time zone tz)::int as hour,
                 count(*)::int as orders
            from public.orders x
           where x.restaurant_id = rid and x.status in ('approved', 'settled')
             and x.created_at >= since
           group by 1
        ) o on o.hour = h.hour
    ),

    -- Monday = 1 … Sunday = 7, over four whole weeks.
    'weekdays', (
      select jsonb_agg(jsonb_build_object(
               'dow', w.dow,
               'orders', coalesce(o.orders, 0),
               'sales_cents', coalesce(s.sales_cents, 0)
             ) order by w.dow)
        from generate_series(1, 7) as w(dow)
        left join (
          select extract(isodow from x.created_at at time zone tz)::int as dow,
                 count(*)::int as orders
            from public.orders x
           where x.restaurant_id = rid and x.status in ('approved', 'settled')
             and x.created_at >= since_4w
           group by 1
        ) o on o.dow = w.dow
        left join (
          select extract(isodow from x.closed_at at time zone tz)::int as dow,
                 sum(x.total_cents)::bigint as sales_cents
            from public.table_sessions x
           where x.restaurant_id = rid and x.status = 'closed' and x.closed_at >= since_4w
           group by 1
        ) s on s.dow = w.dow
    ),

    -- Best sellers by plates sold. Grouped by the dish, not by the name on the
    -- order line, so a renamed dish is one row under the name it has today; a
    -- dish since deleted keeps the name it was sold under.
    'top_dishes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', t.name, 'quantity', t.quantity, 'revenue_cents', t.revenue_cents
             ) order by t.quantity desc, t.revenue_cents desc, t.name), '[]'::jsonb)
        from (
          select coalesce(max(d.name), max(i.name)) as name,
                 sum(i.quantity)::int as quantity,
                 sum(i.line_total_cents)::bigint as revenue_cents
            from public.order_items i
            join public.orders x on x.id = i.order_id
            left join public.dishes d on d.id = i.dish_id
           where x.restaurant_id = rid and x.status in ('approved', 'settled')
             and x.created_at >= since
           group by coalesce(i.dish_id::text, 'name:' || i.name)
           order by 2 desc, 3 desc, 1
           limit 10
        ) t
    ),

    -- Dishes that were on the menu for the whole thirty days, can be ordered
    -- now, and were not ordered once. A dish added last week has not had its
    -- chance yet and is left out.
    'unsold', (
      select jsonb_build_object(
               'count', count(*)::int,
               'names', coalesce(jsonb_agg(u.name order by u.name) filter (where u.rn <= 12),
                                 '[]'::jsonb))
        from (
          select d.name, row_number() over (order by d.name) as rn
            from public.dishes d
           where d.restaurant_id = rid and d.is_available and d.created_at <= since
             and not exists (
               select 1
                 from public.order_items i
                 join public.orders x on x.id = i.order_id
                where i.dish_id = d.id and x.status in ('approved', 'settled')
                  and x.created_at >= since)
        ) u
    ),

    -- Add-ons by how many plates carried them.
    'addons', (
      select coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'count', a.n)
                                order by a.n desc, a.name), '[]'::jsonb)
        from (
          select ad ->> 'name' as name, sum(i.quantity)::int as n
            from public.order_items i
            join public.orders x on x.id = i.order_id
           cross join lateral jsonb_array_elements(
                   case when jsonb_typeof(i.addons) = 'array' then i.addons else '[]'::jsonb end
                 ) as ad
           where x.restaurant_id = rid and x.status in ('approved', 'settled')
             and x.created_at >= since
             and coalesce(ad ->> 'name', '') <> ''
           group by 1
           order by 2 desc, 1
           limit 5
        ) a
    ),

    -- Who places the orders, and where they are eaten.
    'mix', (
      select jsonb_build_object(
               'guest',    count(*) filter (where x.source = 'customer'),
               'waiter',   count(*) filter (where x.source = 'waiter'),
               'dine_in',  count(*) filter (where x.service_type = 'dine_in'),
               'takeaway', count(*) filter (where x.service_type = 'takeaway'))
        from public.orders x
       where x.restaurant_id = rid and x.status in ('approved', 'settled')
         and x.created_at >= since
    ),

    -- The floor, this minute.
    'floor', jsonb_build_object(
      'tables_total', (
        select count(*)::int from public.tables t
         where t.restaurant_id = rid and t.is_active),
      'tables_occupied', (
        select count(distinct st.table_id)::int
          from public.table_session_tables st
          join public.table_sessions x on x.id = st.session_id
         where x.restaurant_id = rid and x.status in ('open', 'bill_requested')),
      'open_bills', (
        select count(*)::int from public.table_sessions x
         where x.restaurant_id = rid and x.status in ('open', 'bill_requested')),
      'open_cents', (
        select coalesce(sum(x.total_cents), 0)::bigint from public.table_sessions x
         where x.restaurant_id = rid and x.status in ('open', 'bill_requested'))
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.restaurant_insights(uuid) from public, anon;
grant execute on function public.restaurant_insights(uuid) to authenticated;


-- ============================================================
-- 20260924003400_leads.sql
-- ============================================================
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

-- ============================================================
-- 20260924003500_lead_cities_seed.sql
-- ============================================================
-- ============================================================================
-- Indian cities and towns for the leads page: one row per place, with the
-- state and district it sits in and its latest population on Wikidata (Census
-- 2011 for most towns). Generated from a Wikidata SPARQL query (CC0) on
-- 2026-10-14; rerun the query and regenerate rather than editing by hand.
-- Re-runnable: an existing row is refreshed, nothing is deleted.
-- ============================================================================

insert into public.lead_cities (id, name, state, district, population, lat, lon, is_metro) values
  ('Q203476', 'Srivijayapuram', 'Andaman and Nicobar Islands', null, 100608, 11.6667, 92.75, false),
  ('Q12996738', 'Chintapalli', 'Andhra Pradesh', 'Alluri Sitharama Raju', null, 17.8667, 82.35, false),
  ('Q1382215', 'Upper Sileru Project Site Camp', 'Andhra Pradesh', 'Alluri Sitharama Raju', 4632, 18.0372, 82.0192, false),
  ('Q5103763', 'Chodavaram', 'Andhra Pradesh', 'Anakapalli', 20251, 17.8316, 82.9352, false),
  ('Q3415001', 'Elamanchili', 'Andhra Pradesh', 'Anakapalli', 27265, 17.549, 82.85, false),
  ('Q11107326', 'Nakkapalle', 'Andhra Pradesh', 'Anakapalli', 7603, 17.4106, 82.7161, false),
  ('Q2563464', 'Narsipatnam', 'Andhra Pradesh', 'Anakapalli', 33757, 17.67, 82.62, false),
  ('Q3418911', 'Payakaraopeta', 'Andhra Pradesh', 'Anakapalli', 27001, 17.3624, 82.5533, false),
  ('Q16339673', 'Peda Boddepalle', 'Andhra Pradesh', 'Anakapalli', 12781, 17.6719, 82.3695, false),
  ('Q760144', 'Ananthapuram', 'Andhra Pradesh', 'Anantapuramu', 267161, 14.6833, 77.6, false),
  ('Q586397', 'Guntakal', 'Andhra Pradesh', 'Anantapuramu', 126270, 15.17, 77.38, false),
  ('Q950921', 'Gutti', 'Andhra Pradesh', 'Anantapuramu', 48658, 15.12, 77.63, false),
  ('Q12992593', 'Kakkalapalle', 'Andhra Pradesh', 'Anantapuramu', 30128, 14.6409, 77.5643, false),
  ('Q2738467', 'Kalyanadurgam', 'Andhra Pradesh', 'Anantapuramu', 32328, 14.55, 77.1, false),
  ('Q3428861', 'Pamidi', 'Andhra Pradesh', 'Anantapuramu', 26886, 14.95, 77.5833, false),
  ('Q13008117', 'Rayadurg', 'Andhra Pradesh', 'Anantapuramu', 61749, 14.7, 76.8667, false),
  ('Q2336339', 'Tadipatri', 'Andhra Pradesh', 'Anantapuramu', 108171, 14.9097, 78.0083, false),
  ('Q736330', 'Uravakonda', 'Andhra Pradesh', 'Anantapuramu', 35565, 14.95, 77.27, false),
  ('Q4833827', 'B.Kothakota', 'Andhra Pradesh', 'Annamayya', 26191, 13.6593, 78.2632, false),
  ('Q15701009', 'Chennamukkapalle', 'Andhra Pradesh', 'Annamayya', 7065, 14.0579, 78.7676, false),
  ('Q6352700', 'Kalikiri', 'Andhra Pradesh', 'Annamayya', 13065, 13.6333, 78.8, false),
  ('Q1017723', 'Madanapalle', 'Andhra Pradesh', 'Annamayya', 180180, 13.55, 78.5, false),
  ('Q14229374', 'Pileru', 'Andhra Pradesh', 'Annamayya', 41489, 13.65, 78.9333, false),
  ('Q2566460', 'Punganur', 'Andhra Pradesh', 'Annamayya', 54746, 13.3649, 78.5714, false),
  ('Q2349951', 'Rayachoti', 'Andhra Pradesh', 'Annamayya', 91234, 14.05, 78.75, false),
  ('Q633274', 'Bapatla', 'Andhra Pradesh', 'Bapatla', 70777, 15.905, 80.468, false),
  ('Q1193800', 'Chirala', 'Andhra Pradesh', 'Bapatla', 172826, 15.82, 80.35, false),
  ('Q13007149', 'Moparru', 'Andhra Pradesh', 'Bapatla', 3324, 16.1059, 80.6209, false),
  ('Q2483836', 'Repalle', 'Andhra Pradesh', 'Bapatla', 50866, 16.02, 80.85, false),
  ('Q2563456', 'Vetapalem', 'Andhra Pradesh', 'Bapatla', 38671, 15.7808, 80.3058, false),
  ('Q11198998', 'Chittoor', 'Andhra Pradesh', 'Chittoor', 160722, 13.2, 79.1167, false),
  ('Q587868', 'Kuppam', 'Andhra Pradesh', 'Chittoor', 21963, 12.745, 78.344, false),
  ('Q13006690', 'Murakambattu (Ct)', 'Andhra Pradesh', 'Chittoor', 6812, 13.2456, 79.1187, false),
  ('Q3869911', 'Nagari', 'Andhra Pradesh', 'Chittoor', 62253, 13.33, 79.58, false),
  ('Q3429934', 'Palamaner', 'Andhra Pradesh', 'Chittoor', 54035, 13.2, 78.75, false),
  ('Q588625', 'Amalapuram', 'Andhra Pradesh', 'Dr. B.R. Ambedkar Konaseema', 53231, 16.5833, 82.0167, false),
  ('Q638742', 'Bandarulanka', 'Andhra Pradesh', 'Dr. B.R. Ambedkar Konaseema', 11470, 16.5869, 81.9692, false),
  ('Q3418988', 'Mummidivaram', 'Andhra Pradesh', 'Dr. B.R. Ambedkar Konaseema', 23732, 16.65, 82.1167, false),
  ('Q721277', 'Ramachandrapuram', 'Andhra Pradesh', 'Dr. B.R. Ambedkar Konaseema', 43657, 16.85, 82.02, false),
  ('Q1387455', 'Dowleswaram', 'Andhra Pradesh', 'East Godavari', 44637, 16.9506, 81.7819, false),
  ('Q2235664', 'Kovvur', 'Andhra Pradesh', 'East Godavari', 39667, 17.0167, 81.7333, false),
  ('Q2249065', 'Mandapeta', 'Andhra Pradesh', 'East Godavari', 56063, 16.87, 81.93, false),
  ('Q2563407', 'Nidadavole', 'Andhra Pradesh', 'East Godavari', 43809, 16.92, 81.67, false),
  ('Q1639492', 'Rajahmundry', 'Andhra Pradesh', 'East Godavari', 341831, 16.9833, 81.7833, false),
  ('Q5101314', 'Chintalapudi', 'Andhra Pradesh', 'Eluru', 25952, 17.068, 80.9936, false),
  ('Q1003496', 'Eluru', 'Andhra Pradesh', 'Eluru', 203780, 16.7117, 81.1031, false),
  ('Q24943329', 'Gavaravaram', 'Andhra Pradesh', 'Eluru', 10029, 16.4314, 80.0515, false),
  ('Q3416178', 'Jangareddygudem', 'Andhra Pradesh', 'Eluru', 48994, 17.1167, 81.3, false),
  ('Q2734090', 'Nuzvid', 'Andhra Pradesh', 'Eluru', 58590, 16.78, 80.85, false),
  ('Q19881964', 'Amaravati', 'Andhra Pradesh', 'Guntur', 103000, 16.5131, 80.5165, false),
  ('Q3120966', 'Guntur', 'Andhra Pradesh', 'Guntur', 647508, 16.3, 80.45, false),
  ('Q137137402', 'Mangalagiri - Tadepalli', 'Andhra Pradesh', 'Guntur', null, 16.445, 80.585, false),
  ('Q720891', 'Ponnur', 'Andhra Pradesh', 'Guntur', 59913, 16.0667, 80.5667, false),
  ('Q1929712', 'Tenali', 'Andhra Pradesh', 'Guntur', 164937, 16.243, 80.64, false),
  ('Q24945947', 'Arempudi', 'Andhra Pradesh', 'Kakinada', 5073, 17.1622, 81.2335, false),
  ('Q3418941', 'Gollaprolu', 'Andhra Pradesh', 'Kakinada', 23882, 17.1541, 82.2867, false),
  ('Q59018', 'Kakinada', 'Andhra Pradesh', 'Kakinada', 384182, 16.9333, 82.2167, false),
  ('Q25562337', 'Peddapuram', 'Andhra Pradesh', 'Kakinada', 49477, 17.08, 82.13, false),
  ('Q2563530', 'Pithapuram', 'Andhra Pradesh', 'Kakinada', 54859, 17.1167, 82.2667, false),
  ('Q2229781', 'Ramanayyapeta', 'Andhra Pradesh', 'Kakinada', 28369, 17.0036, 82.2534, false),
  ('Q2563400', 'Samarlakota', 'Andhra Pradesh', 'Kakinada', 56864, 17.0567, 82.1764, false),
  ('Q2229767', 'Suryaraopeta', 'Andhra Pradesh', 'Kakinada', 24112, 16.8031, 81.6419, false),
  ('Q2576041', 'Tuni', 'Andhra Pradesh', 'Kakinada', 254425, 17.35, 82.55, false),
  ('Q3420558', 'Yeleswaram', 'Andhra Pradesh', 'Kakinada', 32957, 17.2833, 82.1, false),
  ('Q2350125', 'Gudivada', 'Andhra Pradesh', 'Krishna', 118167, 16.43, 80.99, false),
  ('Q3428285', 'Kankipadu', 'Andhra Pradesh', 'Krishna', 14616, 16.45, 80.7833, false),
  ('Q12993258', 'Kanuru', 'Andhra Pradesh', 'Krishna', 49006, 16.495, 80.6891, false),
  ('Q845662', 'Machilipatnam', 'Andhra Pradesh', 'Krishna', 169892, 16.1667, 81.1333, false),
  ('Q2563472', 'Pedana', 'Andhra Pradesh', 'Krishna', 30721, 16.2667, 81.1667, false),
  ('Q3418817', 'Vuyyuru', 'Andhra Pradesh', 'Krishna', 46490, 16.3667, 80.85, false),
  ('Q15702707', 'YSR Tadigadapa', 'Andhra Pradesh', 'Krishna', 17462, 16.4705, 80.6971, false),
  ('Q490906', 'Adoni', 'Andhra Pradesh', 'Kurnool', 184625, 15.63, 77.28, false),
  ('Q5614703', 'Guduru', 'Andhra Pradesh', 'Kurnool', null, 15.7748, 77.8074, false),
  ('Q6425460', 'Kodumur', 'Andhra Pradesh', 'Kurnool', null, 15.6833, 77.7833, false),
  ('Q3635276', 'Kurnool', 'Andhra Pradesh', 'Kurnool', 457633, 15.8222, 78.035, false),
  ('Q13006204', 'Mamidalapadu', 'Andhra Pradesh', 'Kurnool', 26694, 15.831, 78.05, false),
  ('Q2734064', 'Yemmiganuru', 'Andhra Pradesh', 'Kurnool', 95149, 15.768, 77.482, false),
  ('Q10997530', 'Cumbum', 'Andhra Pradesh', 'Markapuram', 15169, 15.5767, 79.1055, false),
  ('Q31500354', 'Giddaluru', 'Andhra Pradesh', 'Markapuram', 35150, 15.3784, 78.9265, false),
  ('Q12992748', 'Kanigiri', 'Andhra Pradesh', 'Markapuram', 37420, 15.4, 79.5166, false),
  ('Q11103996', 'Markapur', 'Andhra Pradesh', 'Markapuram', 71092, 15.735, 79.27, false),
  ('Q2563502', 'Pamur', 'Andhra Pradesh', 'Markapuram', 20000, 15.0944, 79.4139, false),
  ('Q7206808', 'Podili', 'Andhra Pradesh', 'Markapuram', 31145, 15.604, 79.608, false),
  ('Q5619488', 'Guntupalli', 'Andhra Pradesh', 'NTR', 11187, 16.5681, 80.5475, false),
  ('Q5984846', 'Ibrahimpatnam', 'Andhra Pradesh', 'NTR', 29432, 16.5936, 80.5224, false),
  ('Q24908046', 'Jaggayyapeta', 'Andhra Pradesh', 'NTR', 53530, 16.892, 80.0976, false),
  ('Q3764920', 'Kondapalli', 'Andhra Pradesh', 'NTR', 33373, 16.6167, 80.5333, false),
  ('Q3428280', 'Nandigama', 'Andhra Pradesh', 'NTR', 44359, 16.7833, 80.3, false),
  ('Q7289121', 'Ramavarappadu', 'Andhra Pradesh', 'NTR', 22222, 16.5271, 80.6791, false),
  ('Q3418963', 'Tiruvuru', 'Andhra Pradesh', 'NTR', 34173, 17.1, 80.6, false),
  ('Q200017', 'Vijayawada', 'Andhra Pradesh', 'NTR', 1048240, 16.5167, 80.6167, false),
  ('Q3425927', 'Allagadda', 'Andhra Pradesh', 'Nandyal', 29789, 15.1317, 78.5131, false),
  ('Q11028771', 'Atmakuru', 'Andhra Pradesh', 'Nandyal', 39794, 15.8779, 78.5884, false),
  ('Q1553292', 'Banaganapalli', 'Andhra Pradesh', 'Nandyal', 20749, 15.3167, 78.2331, false),
  ('Q11028678', 'Bethamcharla', 'Andhra Pradesh', 'Nandyal', 38994, 15.4667, 78.1667, false),
  ('Q5269732', 'Dhone', 'Andhra Pradesh', 'Nandyal', 59272, 15.4167, 77.8833, false),
  ('Q6963320', 'Nandi Kotkur', 'Andhra Pradesh', 'Nandyal', 46953, 15.8592, 78.2633, false),
  ('Q1772751', 'Nandyal', 'Andhra Pradesh', 'Nandyal', 200516, 15.48, 78.48, false),
  ('Q2269015', 'Srisailam', 'Andhra Pradesh', 'Nandyal', 10288, 16.074, 78.868, false),
  ('Q1105252', 'Chilakaluripet', 'Andhra Pradesh', 'Palnadu', 101398, 16.0892, 80.1672, false),
  ('Q3422646', 'Dachepalle', 'Andhra Pradesh', 'Palnadu', 19042, 16.6, 79.7333, false),
  ('Q5619871', 'Gurazala', 'Andhra Pradesh', 'Palnadu', 26190, 16.5562, 79.6334, false),
  ('Q2241562', 'Macharla', 'Andhra Pradesh', 'Palnadu', 57290, 16.48, 79.43, false),
  ('Q2483789', 'Narasaraopet', 'Andhra Pradesh', 'Palnadu', 116250, 16.236, 80.054, false),
  ('Q10989700', 'Piduguralla', 'Andhra Pradesh', 'Palnadu', 63103, 16.4833, 79.9, false),
  ('Q3445011', 'Sattenapalli', 'Andhra Pradesh', 'Palnadu', 56721, 16.3962, 80.1497, false),
  ('Q2566502', 'Vinukonda', 'Andhra Pradesh', 'Palnadu', 59725, 16.05, 79.75, false),
  ('Q3415029', 'Palakonda', 'Andhra Pradesh', 'Parvathipuram Manyam', 20760, 18.6, 83.75, false),
  ('Q2483828', 'Parvathipuram', 'Andhra Pradesh', 'Parvathipuram Manyam', 53844, 18.7839, 83.4256, false),
  ('Q2563482', 'Saluru', 'Andhra Pradesh', 'Parvathipuram Manyam', 49500, 18.5333, 83.2167, false),
  ('Q58658337', 'Rampachodavaram', 'Andhra Pradesh', 'Polavaram', 9952, 17.4389, 81.7767, false),
  ('Q65665421', 'Addanki', 'Andhra Pradesh', 'Prakasam', 43850, 15.811, 79.9738, false),
  ('Q3428272', 'Chimakurthi', 'Andhra Pradesh', 'Prakasam', 30279, 15.5819, 79.868, false),
  ('Q3298990', 'Darsi', 'Andhra Pradesh', 'Prakasam', 33418, 15.7667, 79.6833, false),
  ('Q2564821', 'Kandukur', 'Andhra Pradesh', 'Prakasam', 57246, 15.2165, 79.9042, false),
  ('Q13006736', 'Mulaguntapadu', 'Andhra Pradesh', 'Prakasam', 7145, 15.298, 80.034, false),
  ('Q1920249', 'Ongole', 'Andhra Pradesh', 'Prakasam', 252739, 15.5, 80.05, false),
  ('Q720856', 'Singarayakonda', 'Andhra Pradesh', 'Prakasam', 24324, 15.25, 80.03, false),
  ('Q3764907', 'Allur', 'Andhra Pradesh', 'Sri Potti Sri Ramulu Nellore', 11656, 14.68, 80.06, false),
  ('Q61437174', 'Buchireddypalem', 'Andhra Pradesh', 'Sri Potti Sri Ramulu Nellore', 38405, 14.538, 79.875, false),
  ('Q1708134', 'Gudur', 'Andhra Pradesh', 'Sri Potti Sri Ramulu Nellore', 74037, 14.1473, 79.8477, false),
  ('Q2138686', 'Kavali', 'Andhra Pradesh', 'Sri Potti Sri Ramulu Nellore', 90099, 14.9123, 79.9944, false),
  ('Q61434', 'Nellore', 'Andhra Pradesh', 'Sri Potti Sri Ramulu Nellore', 547621, 14.4333, 79.9667, false),
  ('Q1948238', 'Dharmavaram', 'Andhra Pradesh', 'Sri Sathya Sai', 121874, 14.4142, 77.715, false),
  ('Q760056', 'Hindupur', 'Andhra Pradesh', 'Sri Sathya Sai', 151677, 13.83, 77.49, false),
  ('Q2351757', 'Kadiri', 'Andhra Pradesh', 'Sri Sathya Sai', 89429, 14.108, 78.161, false),
  ('Q3416802', 'Madakasira', 'Andhra Pradesh', 'Sri Sathya Sai', 21464, 13.9369, 77.2694, false),
  ('Q2572975', 'Penukonda', 'Andhra Pradesh', 'Sri Sathya Sai', 27382, 14.0847, 77.5967, false),
  ('Q1068595', 'Puttaparthi', 'Andhra Pradesh', 'Sri Sathya Sai', 15088, 14.1652, 77.8117, false),
  ('Q3412916', 'Simandepalle', 'Andhra Pradesh', 'Sri Sathya Sai', 18895, 14.0078, 77.6086, false),
  ('Q13007314', 'Yenumulapalli', 'Andhra Pradesh', 'Sri Sathya Sai', 10482, 14.144, 77.817, false),
  ('Q582993', 'Amudalavalasa', 'Andhra Pradesh', 'Srikakulam', 39799, 18.4167, 83.9, false),
  ('Q58871075', 'Hiramandalam', 'Andhra Pradesh', 'Srikakulam', 6603, 18.6667, 83.95, false),
  ('Q952228', 'Ichchapuram', 'Andhra Pradesh', 'Srikakulam', 36493, 19.12, 84.7, false),
  ('Q48723786', 'Kasibugga', 'Andhra Pradesh', 'Srikakulam', null, 18.764, 84.4241, false),
  ('Q3429912', 'Narasannapeta', 'Andhra Pradesh', 'Srikakulam', 26280, 18.4151, 84.0447, false),
  ('Q2734083', 'Palasa Kasibugga', 'Andhra Pradesh', 'Srikakulam', 97551, 18.7725, 84.41, false),
  ('Q3428232', 'Ponduru', 'Andhra Pradesh', 'Srikakulam', 12640, 18.3508, 83.7567, false),
  ('Q58871035', 'Sompeta', 'Andhra Pradesh', 'Srikakulam', 18778, 18.9416, 84.5852, false),
  ('Q671757', 'Srikakulam', 'Andhra Pradesh', 'Srikakulam', 137944, 18.3, 83.9, false),
  ('Q58871127', 'Tekkali', 'Andhra Pradesh', 'Srikakulam', 28631, 18.6167, 84.2333, false),
  ('Q585782', 'Akkarampalle (Ct)', 'Andhra Pradesh', 'Tirupati', 44219, 13.65, 79.42, false),
  ('Q5092016', 'Cherlopalle', 'Andhra Pradesh', 'Tirupati', 6143, 13.6137, 79.3642, false),
  ('Q2349929', 'Narayanavanam', 'Andhra Pradesh', 'Tirupati', 11253, 13.42, 79.58, false),
  ('Q3418143', 'Nayudupeta', 'Andhra Pradesh', 'Tirupati', null, 13.9, 79.9, false),
  ('Q16340057', 'Perur', 'Andhra Pradesh', 'Tirupati', 11127, 13.6077, 79.3768, false),
  ('Q1945739', 'Puttur', 'Andhra Pradesh', 'Tirupati', 53061, 13.45, 79.55, false),
  ('Q720932', 'Renigunta', 'Andhra Pradesh', 'Tirupati', 26031, 13.65, 79.52, false),
  ('Q1772763', 'Srikalahasti', 'Andhra Pradesh', 'Tirupati', 80056, 13.75, 79.7, false),
  ('Q3316919', 'Sullurpeta', 'Andhra Pradesh', 'Tirupati', 27504, 13.7, 80.0167, false),
  ('Q2734231', 'Tiruchanur', 'Andhra Pradesh', 'Tirupati', 22963, 13.6078, 79.4512, false),
  ('Q3424247', 'Tirumala', 'Andhra Pradesh', 'Tirupati', 7741, 13.6822, 79.3493, false),
  ('Q1436816', 'Tirupati', 'Andhra Pradesh', 'Tirupati', 287482, 13.65, 79.42, false),
  ('Q719838', 'Venkatagiri', 'Andhra Pradesh', 'Tirupati', 52688, 13.9667, 79.5833, false),
  ('Q861841', 'Bobbili', 'Andhra Pradesh', 'Vizianagaram', 56819, 18.5751, 83.3583, false),
  ('Q3416910', 'Cheepurupalli', 'Andhra Pradesh', 'Vizianagaram', 14847, 18.3114, 83.5683, false),
  ('Q721344', 'Chintalavalasa', 'Andhra Pradesh', 'Vizianagaram', 5921, 18.0675, 83.4094, false),
  ('Q1525215', 'Gajapathinagaram', 'Andhra Pradesh', 'Vizianagaram', 5687, 18.2804, 83.3448, false),
  ('Q2564934', 'Kanapaka', 'Andhra Pradesh', 'Vizianagaram', 5960, 18.1215, 83.3815, false),
  ('Q2246062', 'Kothavalasa', 'Andhra Pradesh', 'Vizianagaram', 14321, 17.9, 83.2, false),
  ('Q13005685', 'Malicherla', 'Andhra Pradesh', 'Vizianagaram', 5229, 18.0806, 83.3889, false),
  ('Q2563493', 'Nellimarla', 'Andhra Pradesh', 'Vizianagaram', 20498, 18.1667, 83.4333, false),
  ('Q58871178', 'Rajam', 'Andhra Pradesh', 'Vizianagaram', 42197, 18.4492, 83.6594, false),
  ('Q16342058', 'Sriramnagar', 'Andhra Pradesh', 'Vizianagaram', 18893, 18.2844, 83.5406, false),
  ('Q12999041', 'Tummikapalle', 'Andhra Pradesh', 'Vizianagaram', 4911, 17.913, 83.1792, false),
  ('Q3619248', 'Vizianagaram', 'Andhra Pradesh', 'Vizianagaram', 228720, 18.1167, 83.4167, false),
  ('Q3418936', 'Akividu', 'Andhra Pradesh', 'West Godavari', 24506, 16.5812, 81.3747, false),
  ('Q757853', 'Bhimavaram', 'Andhra Pradesh', 'West Godavari', 142184, 16.5424, 81.522, false),
  ('Q379516', 'Narasapuram', 'Andhra Pradesh', 'West Godavari', 58770, 16.4333, 81.6833, false),
  ('Q1945121', 'Palakollu', 'Andhra Pradesh', 'West Godavari', 81199, 16.516, 81.723, false),
  ('Q2235626', 'Tadepalligudem', 'Andhra Pradesh', 'West Godavari', 104032, 16.81, 81.527, false),
  ('Q2566481', 'Tanuku', 'Andhra Pradesh', 'West Godavari', 77962, 16.75, 81.7, false),
  ('Q3412838', 'Badvel', 'Andhra Pradesh', 'YSR  Kadapa', 70626, 14.75, 79.05, false),
  ('Q15704633', 'Dommara Nandyal', 'Andhra Pradesh', 'YSR  Kadapa', 8337, 14.8644, 78.3658, false),
  ('Q12996210', 'Gopavaram', 'Andhra Pradesh', 'YSR  Kadapa', 22936, 14.7849, 78.5706, false),
  ('Q2010440', 'Jammalamadugu', 'Andhra Pradesh', 'YSR  Kadapa', 46069, 14.85, 78.38, false),
  ('Q30651', 'Kadapa', 'Andhra Pradesh', 'YSR  Kadapa', 344893, 14.4667, 78.8167, false),
  ('Q2673715', 'Kamalapuram', 'Andhra Pradesh', 'YSR  Kadapa', 20623, 14.5983, 78.6694, false),
  ('Q3412924', 'Maidukuru', 'Andhra Pradesh', 'YSR  Kadapa', 24843, 14.726, 78.732, false),
  ('Q2563416', 'Moragudi', 'Andhra Pradesh', 'YSR  Kadapa', 6812, 14.8625, 78.3772, false),
  ('Q6931599', 'Muddanur', 'Andhra Pradesh', 'YSR  Kadapa', 9775, 14.6881, 78.3937, false),
  ('Q15705398', 'Nagireddipalli', 'Andhra Pradesh', 'YSR  Kadapa', 12318, 14.2697, 79.1008, false),
  ('Q2349966', 'Proddatur', 'Andhra Pradesh', 'YSR  Kadapa', 163970, 14.73, 78.55, false),
  ('Q2228545', 'Pulivendula', 'Andhra Pradesh', 'YSR  Kadapa', 65706, 14.4167, 78.2333, false),
  ('Q11102384', 'Rajampet', 'Andhra Pradesh', 'YSR  Kadapa', 54050, 14.1833, 79.1666, false),
  ('Q2733280', 'Vaparala', 'Andhra Pradesh', 'YSR  Kadapa', 1580, 14.8586, 78.3481, false),
  ('Q720903', 'Yerraguntla', 'Andhra Pradesh', 'YSR  Kadapa', 32574, 14.6333, 78.5333, false),
  ('Q200016', 'Visakhapatnam', 'Andhra Pradesh', null, 2035922, 17.6939, 83.2922, false),
  ('Q24951907', 'Kaho', 'Arunachal Pradesh', 'Anjaw', null, 28.3043, 97.0243, false),
  ('Q6400755', 'Kharsang', 'Arunachal Pradesh', 'Changlang', null, 27.32, 95.9, false),
  ('Q6962040', 'Nampong', 'Arunachal Pradesh', 'Changlang', null, 27.28, 96.13, false),
  ('Q2729438', 'Koloriang', 'Arunachal Pradesh', 'Kurung Kumey', null, 27.8992, 93.3503, false),
  ('Q13221', 'Tezu', 'Arunachal Pradesh', 'Lohit', 14376, 27.9167, 96.1667, false),
  ('Q663062', 'Ziro', 'Arunachal Pradesh', 'Lower Subansiri', null, 27.595, 93.8385, false),
  ('Q41128', 'Itanagar', 'Arunachal Pradesh', 'Papum Pare', 59490, 27.1, 93.62, false),
  ('Q25247765', 'Pangin', 'Arunachal Pradesh', 'Siang', null, 28.2102, 94.9887, false),
  ('Q70295360', 'Taksing', 'Arunachal Pradesh', 'Upper Subansiri', null, 28.4345, 93.2039, false),
  ('Q859133', 'Biswanath Chariali', 'Assam', 'Bishwanath', null, 26.7278, 93.1517, false),
  ('Q3429538', 'Bongaigaon, Assam, India', 'Assam', 'Bongaigaon', null, 26.48, 90.56, false),
  ('Q12450962', 'Lakhipur', 'Assam', 'Cachar', null, 24.8, 93.02, false),
  ('Q28169357', 'Sonai', 'Assam', 'Cachar', null, 24.7326, 92.8889, false),
  ('Q1729385', 'Sribhumi', 'Assam', 'Cachar', 56854, 24.8667, 92.3667, false),
  ('Q48724100', 'Udharbond', 'Assam', 'Cachar', null, 24.8698, 92.8694, false),
  ('Q24943594', 'Dimow Chariali', 'Assam', 'Dhemaji', null, 27.7619, 94.9986, false),
  ('Q6271960', 'Jonai', 'Assam', 'Dhemaji', null, 27.83, 95.22, false),
  ('Q279871', 'Gauripur', 'Assam', 'Dhubri', 23477, 26.08, 89.97, false),
  ('Q1266637', 'Dibrugarh', 'Assam', 'Dibrugarh', 154019, 27.4833, 94.9, false),
  ('Q16056717', 'Tingkhong', 'Assam', 'Dibrugarh', null, 27.13, 95.1, false),
  ('Q135483655', 'Harangajao', 'Assam', 'Dima Hasao', null, 25.1164, 92.8569, false),
  ('Q1708160', 'Golaghat', 'Assam', 'Golaghat', null, 26.5239, 93.9623, false),
  ('Q28153823', 'Algapur', 'Assam', 'Hailakandi', null, 24.8668, 92.6872, false),
  ('Q914156', 'Hailakandi', 'Assam', 'Hailakandi', null, 24.68, 92.57, false),
  ('Q640538', 'Hojai', 'Assam', 'Hojai', null, 26.0028, 92.8528, false),
  ('Q28419445', 'Agchia', 'Assam', 'Kamrup', null, 26.0005, 91.2653, false),
  ('Q18111492', 'Dadara, Kamrup', 'Assam', 'Kamrup', null, 20.3167, 72.9667, false),
  ('Q24927936', 'Dakhala', 'Assam', 'Kamrup', null, 26.2786, 91.3097, false),
  ('Q24927939', 'Darkuchi', 'Assam', 'Kamrup', null, 26.4045, 91.3842, false),
  ('Q48724994', 'Jalah', 'Assam', 'Kamrup', null, 31.5833, 76.95, false),
  ('Q271911', 'Dispur', 'Assam', 'Kamrup Metropolitan', 734577, 26.15, 91.77, false),
  ('Q199605', 'Guwahati', 'Assam', 'Kamrup Metropolitan', 1116267, 26.1806, 91.7502, false),
  ('Q1937201', 'Jorhat', 'Assam', 'Sivasagar', 153249, 26.7575, 94.2031, false),
  ('Q1284453', 'Sivasagar', 'Assam', 'Sivasagar', null, 26.98, 94.63, false),
  ('Q1021162', 'Tezpur', 'Assam', 'Sonitpur', 100437, 26.62, 92.79, false),
  ('Q48726625', 'Dullabcherra', 'Assam', 'Sribhumi', null, 24.8, 92.7167, false),
  ('Q1924981', 'Margherita', 'Assam', 'Tinsukia', null, 27.28, 95.68, false),
  ('Q7380188', 'Rupai Siding', 'Assam', 'Tinsukia', null, 27.59, 95.55, false),
  ('Q2249428', 'Tinsukia', 'Assam', 'Tinsukia', 99507, 27.4892, 95.36, false),
  ('Q11938328', 'Nagaon', 'Assam', null, 147137, 26.3492, 92.6861, false),
  ('Q139781615', 'Samaguri', 'Assam', null, null, 26.4237, 92.861, false),
  ('Q4660870', 'Araria', 'Bihar', 'Araria', null, 26.1346, 87.4654, false),
  ('Q2286929', 'Jogbani', 'Bihar', 'Araria', null, 26.4024, 87.2656, false),
  ('Q1191619', 'Daudnagar', 'Bihar', 'Aurangabad', null, 25.03, 84.4, false),
  ('Q59213804', 'Deo Town', 'Bihar', 'Aurangabad', 173216, 24.6561, 84.4356, false),
  ('Q2453472', 'Nabinagar', 'Bihar', 'Aurangabad', null, 24.62, 84.12, false),
  ('Q598985', 'Begusarai', 'Bihar', 'Begusarai', 252008, 25.42, 86.13, false),
  ('Q760714', 'Bhagalpur', 'Bihar', 'Bhagalpur', 410210, 25.2444, 86.9719, false),
  ('Q588587', 'Arrah', 'Bihar', 'Bhojpur', 261430, 25.5631, 84.6711, false),
  ('Q1136189', 'Darbhanga', 'Bihar', 'Darbhanga', null, 26.157, 85.8995, false),
  ('Q15229230', 'Jale', 'Bihar', 'Darbhanga', null, 26.38, 85.72, false),
  ('Q7641921', 'Supaul Bazar', 'Bihar', 'Darbhanga', null, 26.1083, 86.6011, false),
  ('Q3630833', 'Kesaria', 'Bihar', 'East Champaran', null, 26.365, 84.873, false),
  ('Q1774606', 'Motihari', 'Bihar', 'East Champaran', null, 26.65, 84.9167, false),
  ('Q2087576', 'Raxaul', 'Bihar', 'East Champaran', null, 26.9833, 84.85, false),
  ('Q15201836', 'Bodhgaya inscription of Mahanaman', 'Bihar', 'Gaya', null, 24.6951, 84.9913, false),
  ('Q11917849', 'Dumaria', 'Bihar', 'Gaya', null, 24.4525, 84.5847, false),
  ('Q251329', 'Gaya', 'Bihar', 'Gaya', 474093, 24.75, 85.0167, false),
  ('Q2453339', 'Manihari', 'Bihar', 'Katihar', null, 25.35, 87.63, false),
  ('Q5518518', 'Galgalia', 'Bihar', 'Kishanganj', null, 26.5273, 88.1134, false),
  ('Q1949375', 'Kishanganj', 'Bihar', 'Kishanganj', null, 26.0794, 87.9372, false),
  ('Q22997102', 'Bagha Kusmar', 'Bihar', 'Madhubani', null, 26.44, 86.43, false),
  ('Q744260', 'Jainagar', 'Bihar', 'Madhubani', null, 26.5833, 86.15, false),
  ('Q2734136', 'Jamalpur', 'Bihar', 'Munger', null, 25.3, 86.5, false),
  ('Q36796', 'Munger', 'Bihar', 'Munger', 213303, 25.381, 86.465, false),
  ('Q1453196', 'Muzaffarpur', 'Bihar', 'Muzaffarpur', 333200, 26.12, 85.3833, false),
  ('Q5659695', 'Harnaut', 'Bihar', 'Nalanda', null, 25.3667, 85.5333, false),
  ('Q2734910', 'Hilsa', 'Bihar', 'Nalanda', null, 25.32, 85.28, false),
  ('Q863683', 'Rajgir', 'Bihar', 'Nalanda', 41587, 25.03, 85.42, false),
  ('Q24906625', 'Athmalgola', 'Bihar', 'Patna', null, 25.27, 85.4, false),
  ('Q27910419', 'Durgawati', 'Bihar', 'Patna', null, 25.2114, 83.5308, false),
  ('Q389755', 'Pataliputra', 'Bihar', 'Patna', null, 25.611, 85.144, false),
  ('Q80484', 'Patna', 'Bihar', 'Patna', 1684222, 25.61, 85.1414, false),
  ('Q25212265', 'Dagarua', 'Bihar', 'Purnia', null, 25.8, 87.64, false),
  ('Q1771762', 'Purnia', 'Bihar', 'Purnia', 310817, 25.78, 87.47, false),
  ('Q19342632', 'Rohtas', 'Bihar', 'Rohtas', null, 24.6281, 83.9199, false),
  ('Q1949410', 'Sasaram', 'Bihar', 'Rohtas', null, 24.95, 84.03, false),
  ('Q1949422', 'Saharsa', 'Bihar', 'Saharsa', 156540, 25.88, 86.6, false),
  ('Q1925191', 'Samastipur', 'Bihar', 'Samastipur', null, 25.85, 85.7667, false),
  ('Q30602136', 'Shikarpur', 'Bihar', 'Saran', null, 27.1082, 84.4665, false),
  ('Q622827', 'Bairgania', 'Bihar', 'Sitamarhi', null, 26.7406, 85.2733, false),
  ('Q2360633', 'Sitamarhi', 'Bihar', 'Sitamarhi', null, 26.6, 85.48, false),
  ('Q7646930', 'Sursand', 'Bihar', 'Sitamarhi', null, 26.65, 85.7167, false),
  ('Q2234098', 'Siwan', 'Bihar', 'Siwan', null, 26.22, 84.36, false),
  ('Q4901787', 'Bhimnagar, Supaul', 'Bihar', 'Supaul', null, 26.4983, 86.9659, false),
  ('Q6444198', 'Kunauli', 'Bihar', 'Supaul', null, 26.4, 86.7, false),
  ('Q19882298', 'Bhagwanpur vaishali', 'Bihar', 'Vaishali', null, 25.858, 85.296, false),
  ('Q1949403', 'Hajipur', 'Bihar', 'Vaishali', null, 25.68, 85.22, false),
  ('Q759222', 'Bettiah', 'Bihar', 'West Champaran', null, 26.8022, 84.4986, false),
  ('Q24952318', 'Dulhin Bazar', 'Bihar', null, null, 25.3817, 84.858, false),
  ('Q24942306', 'Saidpura', 'Bihar', null, null, 25.6142, 85.1667, false),
  ('Q43433', 'Chandigarh', 'Chandigarh', null, 1055450, 30.7333, 76.7797, false),
  ('Q1006363', 'Jagdalpur', 'Chhattisgarh', 'Bastar', 125463, 19.07, 82.03, false),
  ('Q860452', 'Bilaspur', 'Chhattisgarh', 'Bilaspur', 365579, 22.15, 82.0167, false),
  ('Q2733477', 'Deori, Bilaspur district', 'Chhattisgarh', 'Bilaspur', null, 21.45, 82.62, false),
  ('Q6743236', 'Malhar', 'Chhattisgarh', 'Bilaspur', null, 21.7472, 82.5439, false),
  ('Q720204', 'Ratanpur', 'Chhattisgarh', 'Bilaspur', null, 22.3, 82.17, false),
  ('Q3921198', 'Dantewada', 'Chhattisgarh', 'Dantewada', null, 18.9, 81.35, false),
  ('Q1264075', 'Dhamtari', 'Chhattisgarh', 'Dhamtari', null, 20.71, 81.55, false),
  ('Q242144', 'Bhilai', 'Chhattisgarh', 'Durg', 625700, 21.21, 81.38, false),
  ('Q2317191', 'Bhilai Charoda', 'Chhattisgarh', 'Durg', null, 21.2198, 81.4575, false),
  ('Q956602', 'Durg', 'Chhattisgarh', 'Durg', 268806, 21.1915, 81.2762, false),
  ('Q7286150', 'Rajim', 'Chhattisgarh', 'Gariaband', null, 20.965, 81.8817, false),
  ('Q18350183', 'Adbhar', 'Chhattisgarh', 'Janjgir–Champa', null, 21.9514, 83.0255, false),
  ('Q3634114', 'Janjgir', 'Chhattisgarh', 'Janjgir–Champa', null, 22.017, 82.567, false),
  ('Q2120445', 'Kharod', 'Chhattisgarh', 'Janjgir–Champa', null, 21.75, 82.57, false),
  ('Q2734644', 'Sakti', 'Chhattisgarh', 'Janjgir–Champa', null, 22.03, 82.97, false),
  ('Q2008189', 'Korba', 'Chhattisgarh', 'Korba', null, 22.3458, 82.6964, false),
  ('Q1922254', 'Raigarh', 'Chhattisgarh', 'Raigarh', null, 21.9, 83.4, false),
  ('Q7681622', 'Tamnar', 'Chhattisgarh', 'Raigarh', null, 22.05, 83.8, false),
  ('Q6983051', 'Atal Nagar-Nava Raipur', 'Chhattisgarh', 'Raipur', null, 21.161, 81.787, false),
  ('Q2560555', 'Mowa', 'Chhattisgarh', 'Raipur', null, 21.2751, 81.6676, false),
  ('Q372773', 'Raipur', 'Chhattisgarh', 'Raipur', 1010087, 21.2379, 81.6337, false),
  ('Q1229388', 'Sukma', 'Chhattisgarh', 'Sukma', null, 18.3917, 81.6583, false),
  ('Q2088480', 'Ambikapur', 'Chhattisgarh', 'Surguja', 114575, 23.12, 83.2, false),
  ('Q429026', 'Phunderdihari', 'Chhattisgarh', 'Surguja', null, 23.1645, 83.1821, false),
  ('Q24912626', 'Raipur-Bhilai-Durg Tri City Metro area', 'Chhattisgarh', null, null, 20.9167, 82.0, false),
  ('Q22132450', 'Setganga', 'Chhattisgarh', null, null, 22.28, 81.73, false),
  ('Q2760659', 'Dadra', 'Dadra and Nagar Haveli and Daman and Diu', 'Dadra and Nagar Haveli', null, 20.3167, 72.9667, false),
  ('Q318404', 'Silvassa', 'Dadra and Nagar Haveli and Daman and Diu', 'Dadra and Nagar Haveli', 21890, 20.2667, 73.0167, false),
  ('Q463252', 'Daman', 'Dadra and Nagar Haveli and Daman and Diu', 'Daman', null, 20.4169, 72.834, false),
  ('Q631849', 'Diu', 'Dadra and Nagar Haveli and Daman and Diu', 'Diu', 52074, 20.715, 70.9844, false),
  ('Q5577468', 'Gogolá', 'Dadra and Nagar Haveli and Daman and Diu', null, null, 20.7233, 70.9875, false),
  ('Q987', 'New Delhi', 'Delhi', 'New Delhi', 249998, 28.6139, 77.2089, false),
  ('Q48728388', 'Kamal Pur Majra Burari', 'Delhi', 'North Delhi', null, 28.7517, 77.1842, false),
  ('Q48728390', 'Mukand Pur', 'Delhi', 'North Delhi', null, 28.7522, 77.1703, false),
  ('Q48728072', 'Baqiabad', 'Delhi', 'North East Delhi', null, 25.1, 82.9, false),
  ('Q48728076', 'Khan Pur Dhani', 'Delhi', 'North East Delhi', null, 28.7103, 77.2781, false),
  ('Q10576357', 'Mandoli', 'Delhi', 'North East Delhi', null, 28.7075, 77.3003, false),
  ('Q48728078', 'Tukhmir Pur', 'Delhi', 'North East Delhi', null, 28.7078, 77.2547, false),
  ('Q48727882', 'Bakhtawar Pur', 'Delhi', 'North West Delhi', null, 28.8233, 77.1717, false),
  ('Q48727968', 'Bankauli', 'Delhi', 'North West Delhi', null, 28.8111, 77.1394, false),
  ('Q48727883', 'Barwala', 'Delhi', 'North West Delhi', null, 28.7483, 77.0886, false),
  ('Q48727948', 'Bhor Garh', 'Delhi', 'North West Delhi', null, 28.8297, 77.0686, false),
  ('Q48727965', 'Darya Pur Kalan', 'Delhi', 'North West Delhi', null, 28.7614, 76.9842, false),
  ('Q48727871', 'Ibrahim Pur', 'Delhi', 'North West Delhi', null, 28.7797, 77.1644, false),
  ('Q6368203', 'Karala', 'Delhi', 'North West Delhi', null, 28.738, 77.0392, false),
  ('Q48727950', 'Khera Kalan', 'Delhi', 'North West Delhi', null, 28.7811, 77.0989, false),
  ('Q48727971', 'Mukhmel Pur', 'Delhi', 'North West Delhi', null, 28.7875, 77.1414, false),
  ('Q48727875', 'Qadi Pur', 'Delhi', 'North West Delhi', null, 28.7733, 77.1593, false),
  ('Q48727878', 'Tikri Khurd', 'Delhi', 'North West Delhi', null, 28.8336, 77.1114, false),
  ('Q3242297', 'Old Delhi', 'Delhi', 'Old Delhi', null, 28.66, 77.23, false),
  ('Q3639291', 'Bhati', 'Delhi', 'South Delhi', null, 28.5549, 77.1919, false),
  ('Q61453211', 'Chandan Hola', 'Delhi', 'South Delhi', null, 28.4696, 77.1845, false),
  ('Q2335256', 'Jahanpanah', 'Delhi', 'South Delhi', null, 28.521, 77.246, false),
  ('Q25544771', 'Dabri', 'Delhi', 'South West Delhi', null, 28.6094, 77.0897, false),
  ('Q23808268', 'Dindarpur', 'Delhi', 'South West Delhi', null, 28.6, 76.99, false),
  ('Q108227837', 'Aali', 'Delhi', null, null, 28.5203, 77.2936, false),
  ('Q108228329', 'Aya Nagar', 'Delhi', null, null, 28.4706, 77.1264, false),
  ('Q108250894', 'Chattar Pur', 'Delhi', null, null, 28.4958, 77.1683, false),
  ('Q108150764', 'Chilla Saroda Khadar', 'Delhi', null, null, 28.5819, 77.3028, false),
  ('Q1353', 'Delhi', 'Delhi', null, 26495000, 28.6667, 77.2167, true),
  ('Q108254387', 'Dera Mandi', 'Delhi', null, null, 28.4361, 77.1739, false),
  ('Q108254637', 'Fateh Pur Beri', 'Delhi', null, null, 28.4547, 77.1606, false),
  ('Q108208378', 'Lad Pur', 'Delhi', null, null, 28.7339, 76.9703, false),
  ('Q108209953', 'Mohammad Pur Majri', 'Delhi', null, null, 28.7278, 77.0303, false),
  ('Q1320178', 'Mustafabad', 'Delhi', null, null, 28.7111, 77.2688, false),
  ('Q96395867', 'Nithari Village', 'Delhi', null, null, 28.7062, 77.0557, false),
  ('Q108223053', 'Rani Khera', 'Delhi', null, null, 28.7019, 76.9967, false),
  ('Q108266881', 'Saidabad', 'Delhi', null, null, 28.5258, 77.2814, false),
  ('Q131822855', 'Satbari', 'Delhi', null, null, 28.4742, 77.1926, false),
  ('Q7586465', 'Sriniwaspuri', 'Delhi', null, null, 28.5667, 77.25, false),
  ('Q858424', 'Candolim', 'Goa', 'North Goa', null, 15.52, 73.75, false),
  ('Q939521', 'Colvale', 'Goa', 'North Goa', null, 15.62, 73.83, false),
  ('Q1707675', 'Goa Velha', 'Goa', 'North Goa', null, 15.4416, 73.8829, false),
  ('Q2087705', 'Mapusa', 'Goa', 'North Goa', null, 15.5915, 73.809, false),
  ('Q553907', 'Old Goa', 'Goa', 'North Goa', 2550, 15.4425, 73.8831, false),
  ('Q1386327', 'Pale', 'Goa', 'North Goa', null, 15.35, 73.87, false),
  ('Q214681', 'Panaji', 'Goa', 'North Goa', 40017, 15.48, 73.83, false),
  ('Q2248527', 'Reis Magos', 'Goa', 'North Goa', null, 15.4969, 73.8089, false),
  ('Q5029212', 'Canacona', 'Goa', 'South Goa', 12434, 15.0109, 74.0363, false),
  ('Q1190666', 'Cuncolim', 'Goa', 'South Goa', 16623, 15.17, 73.98, false),
  ('Q1190690', 'Curchorem', 'Goa', 'South Goa', 22730, 15.25, 74.1, false),
  ('Q5196020', 'Curtorim', 'Goa', 'South Goa', null, 15.28, 74.03, false),
  ('Q515117', 'Margao', 'Goa', 'South Goa', 87650, 15.2719, 73.9583, false),
  ('Q1814480', 'Mormugao', 'Goa', 'South Goa', 94393, 15.402, 73.8, false),
  ('Q7070625', 'Nuvem', 'Goa', 'South Goa', null, 15.3089, 73.9461, false),
  ('Q2561452', 'Quepem', 'Goa', 'South Goa', null, 15.22, 74.07, false),
  ('Q614055', 'Sanguem', 'Goa', 'South Goa', null, 15.23, 74.17, false),
  ('Q978780', 'Vasco da Gama', 'Goa', 'South Goa', null, 15.3981, 73.8111, false),
  ('Q1070', 'Ahmedabad', 'Gujarat', 'Ahmedabad', 7645000, 23.0219, 72.5797, true),
  ('Q712407', 'Bavla', 'Gujarat', 'Ahmedabad', null, 22.8335, 72.3643, false),
  ('Q2761011', 'Detroj', 'Gujarat', 'Ahmedabad', null, 23.3333, 72.1833, false),
  ('Q1259584', 'Dhandhuka', 'Gujarat', 'Ahmedabad', null, 22.37, 71.98, false),
  ('Q2761956', 'Dholera', 'Gujarat', 'Ahmedabad', null, 22.248, 72.195, false),
  ('Q1263568', 'Dholka', 'Gujarat', 'Ahmedabad', 53792, 22.72, 72.47, false),
  ('Q1609645', 'Jodhpur', 'Gujarat', 'Ahmedabad', null, 21.88, 70.03, false),
  ('Q9443', 'Lothal', 'Gujarat', 'Ahmedabad', null, 22.5214, 72.2494, false),
  ('Q26783813', 'Mandal', 'Gujarat', 'Ahmedabad', null, 23.2887, 71.9185, false),
  ('Q4046905', 'Paldi', 'Gujarat', 'Ahmedabad', null, 23.0061, 72.5647, false),
  ('Q2228906', 'Sanand', 'Gujarat', 'Ahmedabad', null, 22.98, 72.38, false),
  ('Q2451172', 'Viramgam', 'Gujarat', 'Ahmedabad', null, 23.12, 72.03, false),
  ('Q589163', 'Amreli', 'Gujarat', 'Amreli', null, 21.6167, 71.2333, false),
  ('Q8239185', 'Babra', 'Gujarat', 'Amreli', null, 21.8442, 71.3042, false),
  ('Q589286', 'Bagasara', 'Gujarat', 'Amreli', null, 21.4833, 70.95, false),
  ('Q2765597', 'Balel Pipariya', 'Gujarat', 'Amreli', null, 21.7588, 71.1286, false),
  ('Q2761749', 'Dhari', 'Gujarat', 'Amreli', null, 21.3261, 71.0272, false),
  ('Q2007967', 'Jafarabad', 'Gujarat', 'Amreli', null, 20.8667, 71.3667, false),
  ('Q25346043', 'Juna Vaghaniya', 'Gujarat', 'Amreli', null, 21.606, 70.9762, false),
  ('Q2730267', 'Khambha', 'Gujarat', 'Amreli', 10709, 21.1295, 71.2161, false),
  ('Q2240989', 'Lathi', 'Gujarat', 'Amreli', null, 21.72, 71.38, false),
  ('Q2771550', 'Lilia', 'Gujarat', 'Amreli', null, 21.1295, 71.2161, false),
  ('Q2734999', 'Rajula', 'Gujarat', 'Amreli', null, 21.05, 71.43, false),
  ('Q2734216', 'Savarkundla', 'Gujarat', 'Amreli', 73695, 21.337, 71.31, false),
  ('Q1798750', 'Anand', 'Gujarat', 'Anand', 130462, 22.556, 72.951, false),
  ('Q589067', 'Anklav', 'Gujarat', 'Anand', null, 22.3913, 72.9946, false),
  ('Q1740527', 'Khambhat', 'Gujarat', 'Anand', 98700, 22.3131, 72.6194, false),
  ('Q2759998', 'Tarapur', 'Gujarat', 'Anand', null, 22.49, 72.66, false),
  ('Q2724380', 'Umreth', 'Gujarat', 'Anand', null, 22.6986, 73.1156, false),
  ('Q25247367', 'Vasad', 'Gujarat', 'Anand', null, 22.45, 73.0667, false),
  ('Q2767290', 'Bhiloda', 'Gujarat', 'Aravalli', null, 23.46, 73.15, false),
  ('Q5269024', 'Dhansura', 'Gujarat', 'Aravalli', null, 23.35, 73.2, false),
  ('Q2234238', 'Malpur', 'Gujarat', 'Aravalli', null, 23.3591, 73.4646, false),
  ('Q2673443', 'Meghraj', 'Gujarat', 'Aravalli', 11363, 23.5, 73.5, false),
  ('Q2320097', 'Modasa', 'Gujarat', 'Aravalli', null, 23.47, 73.3, false),
  ('Q2722560', 'Amirgadh', 'Gujarat', 'Banaskantha', null, 24.4056, 72.6421, false),
  ('Q3015704', 'Danta', 'Gujarat', 'Banaskantha', null, 24.1886, 72.7658, false),
  ('Q1192618', 'Deesa', 'Gujarat', 'Banaskantha', null, 24.2561, 72.1792, false),
  ('Q949907', 'Palanpur', 'Gujarat', 'Banaskantha', null, 24.1667, 72.4333, false),
  ('Q2771862', 'Vadgam', 'Gujarat', 'Banaskantha', null, 24.0833, 72.4833, false),
  ('Q2724262', 'Amod', 'Gujarat', 'Bharuch', null, 21.991, 72.871, false),
  ('Q588924', 'Ankleshwar', 'Gujarat', 'Bharuch', null, 21.6, 73.0, false),
  ('Q760153', 'Bharuch', 'Gujarat', 'Bharuch', 158253, 21.7, 72.9667, false),
  ('Q2777153', 'Hansot', 'Gujarat', 'Bharuch', null, 21.5833, 72.8, false),
  ('Q2013301', 'Jambusar', 'Gujarat', 'Bharuch', null, 22.05, 72.8, false),
  ('Q2772601', 'Vagra', 'Gujarat', 'Bharuch', null, 21.845, 72.84, false),
  ('Q587137', 'Alang', 'Gujarat', 'Bhavnagar', null, 21.3975, 72.1775, false),
  ('Q242992', 'Bhavnagar', 'Gujarat', 'Bhavnagar', null, 21.765, 72.1369, false),
  ('Q536870', 'Gariadhar', 'Gujarat', 'Bhavnagar', null, 21.53, 71.58, false),
  ('Q1707463', 'Ghogha', 'Gujarat', 'Bhavnagar', null, 21.68, 72.28, false),
  ('Q1924998', 'Mahuva', 'Gujarat', 'Bhavnagar', null, 21.0833, 71.8, false),
  ('Q6730925', 'Palitana', 'Gujarat', 'Bhavnagar', null, 21.52, 71.83, false),
  ('Q2572958', 'Sihor', 'Gujarat', 'Bhavnagar', 52603, 21.7, 71.97, false),
  ('Q766933', 'Talaja', 'Gujarat', 'Bhavnagar', null, 21.35, 72.05, false),
  ('Q24054760', 'Barwala', 'Gujarat', 'Botad', null, 22.15, 71.9, false),
  ('Q858162', 'Botad', 'Gujarat', 'Botad', null, 22.17, 71.67, false),
  ('Q1525333', 'Gadhada', 'Gujarat', 'Botad', null, 21.97, 71.57, false),
  ('Q2770373', 'Ranpur', 'Gujarat', 'Botad', null, 22.3752, 71.6898, false),
  ('Q858207', 'Bodeli', 'Gujarat', 'Chhota Udaipur', null, 22.2791, 73.7104, false),
  ('Q612721', 'Chhota Udepur', 'Gujarat', 'Chhota Udaipur', null, 22.32, 74.01, false),
  ('Q26788214', 'Pavi Jetpur', 'Gujarat', 'Chhota Udaipur', null, 22.3447, 73.8409, false),
  ('Q2774237', 'Sankheda', 'Gujarat', 'Chhota Udaipur', null, 22.1667, 73.5833, false),
  ('Q1262380', 'Dahod', 'Gujarat', 'Dahod', 79185, 22.52, 74.15, false),
  ('Q1263667', 'Devgadh Bariya', 'Gujarat', 'Dahod', null, 22.7022, 73.915, false),
  ('Q2731401', 'Garbada', 'Gujarat', 'Dahod', null, 22.6844, 74.3125, false),
  ('Q3808247', 'Jhalod', 'Gujarat', 'Dahod', null, 23.1003, 74.1561, false),
  ('Q2771499', 'Limkheda', 'Gujarat', 'Dahod', null, 22.8167, 73.9833, false),
  ('Q1964214', 'Ahwa', 'Gujarat', 'Dang', null, 20.75, 73.6833, false),
  ('Q2771789', 'Wadhai', 'Gujarat', 'Dang', null, 20.7667, 73.4833, false),
  ('Q720917', 'Bhanvad', 'Gujarat', 'Devbhumi Dwarka', null, 21.93, 69.78, false),
  ('Q817247', 'Dwarka', 'Gujarat', 'Devbhumi Dwarka', 38873, 22.2403, 68.9686, false),
  ('Q2120093', 'Jamkhambhaliya', 'Gujarat', 'Devbhumi Dwarka', null, 22.2, 69.65, false),
  ('Q582485', 'Dahegam', 'Gujarat', 'Gandhinagar', null, 23.17, 72.82, false),
  ('Q2732118', 'GIFT City', 'Gujarat', 'Gandhinagar', null, 23.1596, 72.6845, false),
  ('Q11910', 'Gandhinagar', 'Gujarat', 'Gandhinagar', 292167, 23.223, 72.65, false),
  ('Q2558704', 'Kalol', 'Gujarat', 'Gandhinagar', null, 23.2257, 72.5168, false),
  ('Q720211', 'Mansa', 'Gujarat', 'Gandhinagar', null, 23.4256, 72.6574, false),
  ('Q2239007', 'Kodinar', 'Gujarat', 'Gir Somnath', null, 20.86, 70.8, false),
  ('Q2775790', 'Sutrapada', 'Gujarat', 'Gir Somnath', null, 20.8928, 70.465, false),
  ('Q2760007', 'Talala', 'Gujarat', 'Gir Somnath', null, 21.0544, 70.5311, false),
  ('Q1622928', 'Una', 'Gujarat', 'Gir Somnath', null, 20.82, 71.03, false),
  ('Q518791', 'Veraval', 'Gujarat', 'Gir Somnath', 153696, 20.9, 70.37, false),
  ('Q927778', 'Dhrol', 'Gujarat', 'Jamnagar', null, 22.5689, 70.4125, false),
  ('Q2008063', 'Jam Jodhpur', 'Gujarat', 'Jamnagar', null, 21.88, 70.03, false),
  ('Q1154', 'Jamnagar', 'Gujarat', 'Jamnagar', 877000, 22.47, 70.07, false),
  ('Q2758600', 'Jodia', 'Gujarat', 'Jamnagar', null, 22.7, 70.3, false),
  ('Q2251785', 'Kalavad', 'Gujarat', 'Jamnagar', null, 22.22, 70.38, false),
  ('Q2771361', 'Lalpur', 'Gujarat', 'Jamnagar', null, 22.1907, 69.9635, false),
  ('Q11864', 'Junagadh', 'Gujarat', 'Junagadh', 465000, 21.52, 70.47, false),
  ('Q599414', 'Keshod', 'Gujarat', 'Junagadh', null, 21.3, 70.25, false),
  ('Q1330938', 'Manavadar', 'Gujarat', 'Junagadh', null, 21.5, 70.13, false),
  ('Q2577440', 'Mangrol', 'Gujarat', 'Junagadh', null, 21.12, 70.12, false),
  ('Q2768932', 'Mendarda', 'Gujarat', 'Junagadh', null, 21.3202, 70.4385, false),
  ('Q721294', 'Vanthali', 'Gujarat', 'Junagadh', null, 21.4833, 70.3333, false),
  ('Q607388', 'Chaklasi', 'Gujarat', 'Kheda', null, 22.65, 72.93, false),
  ('Q1192377', 'Dakor', 'Gujarat', 'Kheda', null, 22.7528, 73.1511, false),
  ('Q2341421', 'Kapadvanj', 'Gujarat', 'Kheda', null, 23.02, 73.07, false),
  ('Q2726525', 'Kathlal', 'Gujarat', 'Kheda', null, 22.895, 72.99, false),
  ('Q775759', 'Kheda', 'Gujarat', 'Kheda', null, 22.75, 72.68, false),
  ('Q2233469', 'Mahemdavad', 'Gujarat', 'Kheda', null, 22.83, 72.77, false),
  ('Q2606805', 'Mahudha', 'Gujarat', 'Kheda', null, 22.82, 72.93, false),
  ('Q2768427', 'Matar', 'Gujarat', 'Kheda', null, 22.75, 72.68, false),
  ('Q219039', 'Nadiad', 'Gujarat', 'Kheda', 225132, 22.7, 72.87, false),
  ('Q2759268', 'Thasra', 'Gujarat', 'Kheda', null, 22.7983, 73.2117, false),
  ('Q4682951', 'Adipur', 'Gujarat', 'Kutch', null, 23.0735, 70.0906, false),
  ('Q1945434', 'Anjar', 'Gujarat', 'Kutch', null, 23.1125, 70.025, false),
  ('Q759550', 'Bhachau', 'Gujarat', 'Kutch', null, 23.28, 70.35, false),
  ('Q798382', 'Bhuj', 'Gujarat', 'Kutch', 188236, 23.25, 69.67, false),
  ('Q41543', 'Gandhidham', 'Gujarat', 'Kutch', null, 23.0681, 70.1283, false),
  ('Q581480', 'Kandla', 'Gujarat', 'Kutch', null, 23.03, 70.22, false),
  ('Q2771159', 'Lakhpat', 'Gujarat', 'Kutch', null, 23.8261, 68.7769, false),
  ('Q2570689', 'Mandvi', 'Gujarat', 'Kutch', null, 22.8339, 69.3496, false),
  ('Q2234250', 'Mundra', 'Gujarat', 'Kutch', 20338, 22.85, 69.73, false),
  ('Q2762064', 'Nakhatrana', 'Gujarat', 'Kutch', null, 23.35, 69.2633, false),
  ('Q6960925', 'Naliya', 'Gujarat', 'Kutch', 11415, 23.2611, 68.8267, false),
  ('Q15261957', 'New Bhuj', 'Gujarat', 'Kutch', null, 23.2667, 69.6667, false),
  ('Q7131859', 'Pantiya', 'Gujarat', 'Kutch', null, 23.1004, 69.9121, false),
  ('Q2724400', 'Rapar', 'Gujarat', 'Kutch', null, 23.57, 70.63, false),
  ('Q7408505', 'Samakhiali', 'Gujarat', 'Kutch', null, 23.3052, 70.5057, false),
  ('Q15287346', 'Sukhpar', 'Gujarat', 'Kutch', null, 23.2157, 69.6076, false),
  ('Q667155', 'Kadana', 'Gujarat', 'Mahisagar', null, 23.2896, 73.8382, false),
  ('Q30621429', 'Khanpur', 'Gujarat', 'Mahisagar', null, 23.28, 73.18, false),
  ('Q2240915', 'Lunavada', 'Gujarat', 'Mahisagar', null, 23.1333, 73.6167, false),
  ('Q2773235', 'Virpur', 'Gujarat', 'Mahisagar', null, 23.1892, 73.4799, false),
  ('Q4878547', 'Bahucharaji', 'Gujarat', 'Mehsana', null, 23.498, 72.043, false),
  ('Q2726621', 'Kadi', 'Gujarat', 'Mehsana', null, 23.2992, 72.3336, false),
  ('Q2236264', 'Kheralu', 'Gujarat', 'Mehsana', null, 23.88, 72.62, false),
  ('Q1922283', 'Mehsana', 'Gujarat', 'Mehsana', 184991, 23.6, 72.4, false),
  ('Q2774449', 'Satlasana', 'Gujarat', 'Mehsana', null, 23.6, 72.4, false),
  ('Q767916', 'Unjha', 'Gujarat', 'Mehsana', null, 23.8, 72.4, false),
  ('Q2570726', 'Vadnagar', 'Gujarat', 'Mehsana', 27790, 23.785, 72.64, false),
  ('Q2234286', 'Vijapur', 'Gujarat', 'Mehsana', null, 23.57, 72.75, false),
  ('Q2452712', 'Visnagar', 'Gujarat', 'Mehsana', null, 23.7, 72.55, false),
  ('Q1707007', 'Halvad', 'Gujarat', 'Morbi', null, 23.02, 71.18, false),
  ('Q2768661', 'Maliya Miyana', 'Gujarat', 'Morbi', null, 23.094, 70.758, false),
  ('Q2087713', 'Morbi', 'Gujarat', 'Morbi', null, 22.8167, 70.8333, false),
  ('Q7683522', 'Tankara', 'Gujarat', 'Morbi', null, 22.66, 70.73, false),
  ('Q2006496', 'Wankaner', 'Gujarat', 'Morbi', null, 22.6161, 70.9531, false),
  ('Q26866040', 'Dediapada', 'Gujarat', 'Narmada', null, 21.6333, 73.5833, false),
  ('Q1816866', 'Rajpipla', 'Gujarat', 'Narmada', 54923, 21.8704, 73.5026, false),
  ('Q2760078', 'Tilakwada', 'Gujarat', 'Narmada', null, 21.78, 73.57, false),
  ('Q2722530', 'Amalsad', 'Gujarat', 'Navsari', null, 20.8139, 72.9553, false),
  ('Q862141', 'Bilimora', 'Gujarat', 'Navsari', null, 20.75, 72.95, false),
  ('Q1945471', 'Chikhli', 'Gujarat', 'Navsari', 6953, 20.75, 73.07, false),
  ('Q721365', 'Gandevi', 'Gujarat', 'Navsari', null, 20.82, 72.98, false),
  ('Q2013180', 'Jalalpore', 'Gujarat', 'Navsari', null, 20.9491, 72.9136, false),
  ('Q1922248', 'Navsari', 'Gujarat', 'Navsari', null, 20.9506, 72.9231, false),
  ('Q2724780', 'Vansda', 'Gujarat', 'Navsari', null, 20.45, 73.22, false),
  ('Q1708114', 'Godhra', 'Gujarat', 'Panchmahal', 161925, 22.7755, 73.6149, false),
  ('Q1707605', 'Halol', 'Gujarat', 'Panchmahal', null, 22.5, 73.47, false),
  ('Q2757721', 'Jambughoda', 'Gujarat', 'Panchmahal', null, 22.3667, 73.7167, false),
  ('Q859113', 'Chanasma', 'Gujarat', 'Patan', null, 23.72, 72.12, false),
  ('Q1708423', 'Harij', 'Gujarat', 'Patan', null, 23.7, 71.9, false),
  ('Q579702', 'Patan', 'Gujarat', 'Patan', 125497, 23.85, 72.1167, false),
  ('Q2068178', 'Radhanpur', 'Gujarat', 'Patan', null, 23.83, 71.6, false),
  ('Q2774598', 'Sami', 'Gujarat', 'Patan', null, 23.6872, 71.7786, false),
  ('Q2774970', 'Santalpur', 'Gujarat', 'Patan', null, 23.8767, 71.3576, false),
  ('Q2572203', 'Siddhpur', 'Gujarat', 'Patan', null, 23.9178, 72.3721, false),
  ('Q976318', 'Chhaya', 'Gujarat', 'Porbandar', null, 21.6525, 69.6746, false),
  ('Q2238993', 'Kutiyana', 'Gujarat', 'Porbandar', null, 21.63, 69.98, false),
  ('Q6419912', 'Porbandar', 'Gujarat', 'Porbandar', null, 21.6425, 69.6047, false),
  ('Q2570700', 'Ranavav', 'Gujarat', 'Porbandar', null, 21.68, 69.75, false),
  ('Q1259573', 'Dhoraji', 'Gujarat', 'Rajkot', null, 21.7337, 70.4499, false),
  ('Q1536978', 'Gondal', 'Gujarat', 'Rajkot', null, 21.97, 70.8, false),
  ('Q1714838', 'Jasdan', 'Gujarat', 'Rajkot', 48483, 22.03, 71.2, false),
  ('Q968713', 'Jetpur', 'Gujarat', 'Rajkot', null, 21.7333, 70.6167, false),
  ('Q2575916', 'Paddhari', 'Gujarat', 'Rajkot', null, 22.43, 70.6, false),
  ('Q11854', 'Rajkot', 'Gujarat', 'Rajkot', 2043000, 22.2917, 70.7933, false),
  ('Q2734950', 'Upleta', 'Gujarat', 'Rajkot', null, 21.73, 70.28, false),
  ('Q1755548', 'Idar', 'Gujarat', 'Sabarkantha', null, 23.83, 73.0, false),
  ('Q9461', 'Khedbrahma', 'Gujarat', 'Sabarkantha', 25001, 24.0299, 73.0463, false),
  ('Q2724388', 'Prantij', 'Gujarat', 'Sabarkantha', null, 23.4384, 72.8572, false),
  ('Q2570216', 'Talod', 'Gujarat', 'Sabarkantha', null, 23.3519, 72.9533, false),
  ('Q2771964', 'Vadali', 'Gujarat', 'Sabarkantha', null, 23.9408, 73.0403, false),
  ('Q712003', 'Bardoli', 'Gujarat', 'Surat', null, 21.12, 73.12, false),
  ('Q6359640', 'Kamrej', 'Gujarat', 'Surat', null, 21.1364, 72.9572, false),
  ('Q6369000', 'Karchelia', 'Gujarat', 'Surat', null, 20.95, 73.15, false),
  ('Q2768146', 'Mahuva, Surat', 'Gujarat', 'Surat', null, 21.02, 73.15, false),
  ('Q2726258', 'Olpad', 'Gujarat', 'Surat', null, 21.3333, 72.75, false),
  ('Q2763782', 'Palsana', 'Gujarat', 'Surat', null, 21.08, 72.98, false),
  ('Q278443', 'Sayan', 'Gujarat', 'Surat', null, 21.3199, 72.8817, false),
  ('Q2725556', 'Umarpada', 'Gujarat', 'Surat', null, 21.45, 73.5, false),
  ('Q2723942', 'Chotila', 'Gujarat', 'Surendranagar', null, 22.425, 71.2, false),
  ('Q2756818', 'Chuda', 'Gujarat', 'Surendranagar', null, 22.4794, 71.6808, false),
  ('Q1265559', 'Dhrangadhra', 'Gujarat', 'Surendranagar', null, 22.9896, 71.4631, false),
  ('Q2771149', 'Lakhtar', 'Gujarat', 'Surendranagar', null, 22.8575, 71.7879, false),
  ('Q715228', 'Limbdi', 'Gujarat', 'Surendranagar', null, 22.57, 71.8, false),
  ('Q2768906', 'Muli', 'Gujarat', 'Surendranagar', null, 22.6388, 71.458, false),
  ('Q2775259', 'Sayla', 'Gujarat', 'Surendranagar', null, 22.5333, 71.5333, false),
  ('Q304278', 'Surendranagar', 'Gujarat', 'Surendranagar', null, 22.725, 71.6333, false),
  ('Q2231030', 'Thangadh', 'Gujarat', 'Surendranagar', null, 22.5667, 71.1833, false),
  ('Q1023682', 'Wadhwan', 'Gujarat', 'Surendranagar', null, 22.7, 71.6833, false),
  ('Q2758910', 'Zinzuwada', 'Gujarat', 'Surendranagar', null, 23.35, 71.7, false),
  ('Q26928895', 'Nizar', 'Gujarat', 'Tapi', null, 21.47, 74.19, false),
  ('Q2725098', 'Uchchhal', 'Gujarat', 'Tapi', null, 21.177, 73.769, false),
  ('Q2772908', 'Valod', 'Gujarat', 'Tapi', null, 21.04, 73.24, false),
  ('Q1964842', 'Vyara', 'Gujarat', 'Tapi', null, 21.12, 73.4, false),
  ('Q2900619', 'Bhadarwa', 'Gujarat', 'Vadodara', null, 22.2587, 71.1924, false),
  ('Q1156554', 'Dabhoi', 'Gujarat', 'Vadodara', null, 22.1295, 73.4176, false),
  ('Q5437418', 'Fatehgunj', 'Gujarat', 'Vadodara', null, 22.3207, 73.1882, false),
  ('Q2295886', 'Karjan', 'Gujarat', 'Vadodara', null, 22.053, 73.1235, false),
  ('Q2247454', 'Padra', 'Gujarat', 'Vadodara', null, 22.23, 73.08, false),
  ('Q7428379', 'Savli', 'Gujarat', 'Vadodara', null, 22.5667, 73.2167, false),
  ('Q2773921', 'Sinor', 'Gujarat', 'Vadodara', null, 22.0, 73.3, false),
  ('Q11909', 'Vadodara', 'Gujarat', 'Vadodara', 3100260, 22.3, 73.2, false),
  ('Q2724952', 'Waghodia', 'Gujarat', 'Vadodara', null, 22.3, 73.38, false),
  ('Q20767736', 'Atul', 'Gujarat', 'Valsad', null, 20.5288, 72.9412, false),
  ('Q2465676', 'Dharampur', 'Gujarat', 'Valsad', null, 20.5383, 73.1747, false),
  ('Q1925363', 'Pardi', 'Gujarat', 'Valsad', null, 20.52, 72.95, false),
  ('Q2735009', 'Parnera', 'Gujarat', 'Valsad', null, 20.55, 72.95, false),
  ('Q302654', 'Valsad', 'Gujarat', 'Valsad', null, 20.6333, 72.9333, false),
  ('Q2087696', 'Vapi', 'Gujarat', 'Valsad', null, 20.3667, 72.9, false),
  ('Q2767083', 'Bhabhar', 'Gujarat', 'Vav-Tharad', null, 24.0718, 71.5892, false),
  ('Q1266017', 'Dhanera', 'Gujarat', 'Vav-Tharad', null, 24.52, 72.02, false),
  ('Q20850173', 'Diyodar', 'Gujarat', 'Vav-Tharad', null, 24.1076, 71.7678, false),
  ('Q2760242', 'Thara', 'Gujarat', 'Vav-Tharad', null, 23.968, 71.824, false),
  ('Q2557742', 'Tharad', 'Gujarat', 'Vav-Tharad', null, 24.3926, 71.6248, false),
  ('Q2772926', 'Vav', 'Gujarat', 'Vav-Tharad', null, 24.3583, 71.5, false),
  ('Q3192309', 'Kamadhia', 'Gujarat', null, null, 21.8333, 70.9333, false),
  ('Q2769626', 'Morva (Hadaf)', 'Gujarat', null, null, 22.9047, 73.8391, false),
  ('Q6966092', 'Naroda', 'Gujarat', null, null, 23.0833, 72.6667, false),
  ('Q7237228', 'Prabhas Patan', 'Gujarat', null, null, 20.91, 70.37, false),
  ('Q7387597', 'S. K. Varma Nagar', 'Gujarat', null, null, 23.685, 68.718, false),
  ('Q720816', 'Santrampur', 'Gujarat', null, null, 23.1895, 73.8928, false),
  ('Q2734240', 'Songadh', 'Gujarat', null, null, 21.17, 73.57, false),
  ('Q4629', 'Surat', 'Gujarat', null, 5935000, 21.205, 72.84, false),
  ('Q2772307', 'Vallabhi', 'Gujarat', null, null, 21.8878, 71.8795, false),
  ('Q456624', 'Ambala', 'Haryana', 'Ambala', 195153, 30.3786, 76.7725, false),
  ('Q29652468', 'Shahzadpur', 'Haryana', 'Ambala', null, 30.4461, 77.0333, false),
  ('Q796669', 'Bhiwani', 'Haryana', 'Bhiwani', 197662, 28.7833, 76.1333, false),
  ('Q888946', 'Charkhi Dadri', 'Haryana', 'Bhiwani', 44892, 28.59, 76.27, false),
  ('Q200663', 'Faridabad', 'Haryana', 'Faridabad', 1404653, 28.4112, 77.3132, false),
  ('Q616583', 'Hodal', 'Haryana', 'Faridabad', null, 27.9, 77.37, false),
  ('Q527194', 'Tohana', 'Haryana', 'Fatehabad', null, 29.7, 75.9, false),
  ('Q238508', 'Gurgaon', 'Haryana', 'Gurugram', 876824, 28.4667, 77.0333, false),
  ('Q1709688', 'Haileymandi', 'Haryana', 'Gurugram', null, 28.3513, 76.7564, false),
  ('Q1949364', 'Rewari', 'Haryana', 'Gurugram', null, 28.1833, 76.6167, false),
  ('Q24951933', 'Adampur', 'Haryana', 'Hisar', null, 29.2832, 75.43, false),
  ('Q1772825', 'Hisar', 'Haryana', 'Hisar', 307024, 29.1489, 75.7367, false),
  ('Q1949385', 'Kaithal', 'Haryana', 'Kaithal', null, 29.8017, 76.3967, false),
  ('Q593256', 'Kurukshetra', 'Haryana', 'Kurukshetra', null, 29.9708, 76.85, false),
  ('Q17077319', 'Nangal Choudhary', 'Haryana', 'Mahendragarh', null, 27.8923, 76.1122, false),
  ('Q2341892', 'Narnaul', 'Haryana', 'Mahendragarh', 252786, 28.0444, 76.1083, false),
  ('Q882172', 'Panchkula', 'Haryana', 'Panchkula', null, 30.6944, 76.8503, false),
  ('Q30693723', 'Israna', 'Haryana', 'Panipat', null, 29.2738, 76.8462, false),
  ('Q139706', 'Panipat', 'Haryana', 'Panipat', null, 29.3875, 76.97, false),
  ('Q1453180', 'Rohtak', 'Haryana', 'Rohtak', 374292, 28.9, 76.5667, false),
  ('Q41561', 'Sonipat', 'Haryana', 'Sonipat', null, 28.9958, 77.0114, false),
  ('Q3639927', 'Bilaspur', 'Haryana', 'Yamunanagar', 9620, 30.3044, 77.3028, false),
  ('Q2016879', 'Jagadhri', 'Haryana', 'Yamunanagar', null, 30.1667, 77.3031, false),
  ('Q55615927', 'Khizri', 'Haryana', 'Yamunanagar', null, 30.3175, 77.5024, false),
  ('Q1807929', 'Yamunanagar', 'Haryana', 'Yamunanagar', null, 30.1289, 77.2803, false),
  ('Q14206683', 'Bhondsi', 'Haryana', null, null, 28.3497, 77.0626, false),
  ('Q17055090', 'Hisar Urban Agglomeration', 'Haryana', null, null, 29.15, 75.7, false),
  ('Q1807935', 'Jind', 'Haryana', null, null, 29.3161, 76.3142, false),
  ('Q19459305', 'Kaimla', 'Haryana', null, null, 29.506, 76.997, false),
  ('Q24952263', 'Mullana', 'Haryana', null, null, 30.1502, 77.0242, false),
  ('Q24906131', 'Nissing', 'Haryana', null, null, 29.69, 76.75, false),
  ('Q30624191', 'Thana Khurd', 'Haryana', null, null, 28.89, 76.95, false),
  ('Q860424', 'Bilaspur, Himachal Pradesh', 'Himachal Pradesh', 'Bilaspur', null, 31.3454, 76.7596, false),
  ('Q1026898', 'Naina Devi', 'Himachal Pradesh', 'Bilaspur', null, 31.306, 76.5364, false),
  ('Q30637181', 'Bassa, Chamba', 'Himachal Pradesh', 'Chamba', null, 32.57, 76.13, false),
  ('Q4901297', 'Bharmour', 'Himachal Pradesh', 'Chamba', null, 32.26, 76.32, false),
  ('Q27961958', 'Barsar', 'Himachal Pradesh', 'Hamirpur', null, 31.5264, 76.4625, false),
  ('Q186182', 'Dharamshala', 'Himachal Pradesh', 'Kangra', 19034, 32.2153, 76.3186, false),
  ('Q2286867', 'Jawalamukhi', 'Himachal Pradesh', 'Kangra', null, 31.8744, 76.32, false),
  ('Q2391202', 'Nurpur', 'Himachal Pradesh', 'Kangra', null, 32.3, 75.9, false),
  ('Q2295877', 'Palampur', 'Himachal Pradesh', 'Kangra', null, 32.12, 76.53, false),
  ('Q7228488', 'Poo', 'Himachal Pradesh', 'Kinnaur', null, 31.7667, 78.5833, false),
  ('Q7418032', 'Sangla', 'Himachal Pradesh', 'Kinnaur', null, 31.4264, 78.265, false),
  ('Q83442', 'Kullu', 'Himachal Pradesh', 'Kullu', 18536, 31.96, 77.1, false),
  ('Q83443', 'Manali', 'Himachal Pradesh', 'Kullu', 8096, 32.245, 77.1882, false),
  ('Q83473', 'Manikaran', 'Himachal Pradesh', 'Kullu', null, 32.0269, 77.3452, false),
  ('Q1013544', 'Kaza', 'Himachal Pradesh', 'Lahaul and Spiti', 1694, 32.2256, 78.0714, false),
  ('Q48725693', 'Kotli', 'Himachal Pradesh', 'Mandi', null, 31.7574, 76.8728, false),
  ('Q195931', 'Mandi', 'Himachal Pradesh', 'Mandi', 26422, 31.7108, 76.9294, false),
  ('Q24927883', 'Kasumpati', 'Himachal Pradesh', 'Shimla', null, 31.07, 77.18, false),
  ('Q3200369', 'Kumharsain', 'Himachal Pradesh', 'Shimla', null, 31.3167, 77.5, false),
  ('Q6783187', 'Mashobra', 'Himachal Pradesh', 'Shimla', null, 31.13, 77.23, false),
  ('Q568317', 'Narkanda', 'Himachal Pradesh', 'Shimla', null, 31.27, 77.45, false),
  ('Q83786', 'Shimla', 'Himachal Pradesh', 'Shimla', 206575, 31.1033, 77.1722, false),
  ('Q781615', 'Nahan', 'Himachal Pradesh', 'Sirmaur', null, 30.56, 77.2933, false),
  ('Q2734471', 'Paonta Sahib', 'Himachal Pradesh', 'Sirmaur', null, 30.45, 77.62, false),
  ('Q2231162', 'Rajgarh', 'Himachal Pradesh', 'Sirmaur', null, 30.85, 77.3, false),
  ('Q83398', 'Barog', 'Himachal Pradesh', 'Solan', 1500, 30.89, 77.082, false),
  ('Q462766', 'Solan', 'Himachal Pradesh', 'Solan', 39256, 30.92, 77.12, false),
  ('Q4740923', 'Amb', 'Himachal Pradesh', 'Una', null, 31.6798, 76.1175, false),
  ('Q30642887', 'Bangana town', 'Himachal Pradesh', 'Una', null, 31.6138, 76.3579, false),
  ('Q28173952', 'Raipur Maidan', 'Himachal Pradesh', 'Una', null, 31.476, 76.383, false),
  ('Q30622001', 'Bhaba Nagar', 'Himachal Pradesh', null, null, 31.5653, 77.9347, false),
  ('Q28173862', 'Bhoranj', 'Himachal Pradesh', null, null, 31.644, 76.642, false),
  ('Q55640163', 'Jol Bangana', 'Himachal Pradesh', null, null, 31.608, 76.256, false),
  ('Q14219787', 'Sarkidhar', 'Himachal Pradesh', null, null, 31.1425, 76.8181, false),
  ('Q65071583', 'Aishmuqam', 'Jammu and Kashmir', 'Anantnag', null, 33.8633, 75.2811, false),
  ('Q11360899', 'Anantnag', 'Jammu and Kashmir', 'Anantnag', 108505, 33.73, 75.15, false),
  ('Q2242859', 'Kokernag', 'Jammu and Kashmir', 'Anantnag', null, 33.5874, 75.2993, false),
  ('Q2362686', 'Mattan', 'Jammu and Kashmir', 'Anantnag', null, 33.7622, 75.2097, false),
  ('Q2085326', 'Pahalgam', 'Jammu and Kashmir', 'Anantnag', null, 34.0322, 75.3222, false),
  ('Q17082685', 'Shangus', 'Jammu and Kashmir', 'Anantnag', null, 33.7014, 75.2858, false),
  ('Q1525544', 'Verinag', 'Jammu and Kashmir', 'Anantnag', null, 33.5392, 75.2497, false),
  ('Q625761', 'Bandipore', 'Jammu and Kashmir', 'Bandipore', 27482, 34.4225, 74.6375, false),
  ('Q712644', 'Baramulla', 'Jammu and Kashmir', 'Baramulla', 71434, 34.2089, 74.3428, false),
  ('Q2231768', 'Kunzer', 'Jammu and Kashmir', 'Baramulla', null, 34.0833, 74.5, false),
  ('Q2228603', 'Pattan', 'Jammu and Kashmir', 'Baramulla', null, 34.1611, 74.5556, false),
  ('Q2321929', 'Sopore', 'Jammu and Kashmir', 'Baramulla', 118608, 34.2864, 74.4628, false),
  ('Q3976899', 'Sumbal', 'Jammu and Kashmir', 'Baramulla', null, 34.2311, 74.6447, false),
  ('Q3853186', 'Tangmarg', 'Jammu and Kashmir', 'Baramulla', null, 34.0592, 74.4244, false),
  ('Q2226434', 'Uri', 'Jammu and Kashmir', 'Baramulla', null, 34.0833, 74.0333, false),
  ('Q24945315', 'Watergam', 'Jammu and Kashmir', 'Baramulla', null, 34.31, 74.37, false),
  ('Q2229351', 'Magam', 'Jammu and Kashmir', 'Budgam', null, 34.0928, 74.5914, false),
  ('Q96394887', 'Narbal', 'Jammu and Kashmir', 'Budgam', null, 34.1167, 74.6728, false),
  ('Q23808365', 'The Gateway of Gulmarg', 'Jammu and Kashmir', 'Budgam', null, 34.08, 74.58, false),
  ('Q760372', 'Bhaderwah', 'Jammu and Kashmir', 'Doda', null, 32.98, 75.72, false),
  ('Q24935095', 'Thathri', 'Jammu and Kashmir', 'Doda', null, 33.1353, 75.5175, false),
  ('Q6548068', 'Kangan', 'Jammu and Kashmir', 'Ganderbal', null, 34.2631, 74.9028, false),
  ('Q16897756', 'Safapora', 'Jammu and Kashmir', 'Ganderbal', null, 34.2597, 74.6661, false),
  ('Q590115', 'Akhnoor', 'Jammu and Kashmir', 'Jammu', 10770, 32.8667, 74.7333, false),
  ('Q255455', 'Jammu', 'Jammu and Kashmir', 'Jammu', 502197, 32.7333, 74.85, false),
  ('Q55633144', 'Sidhra', 'Jammu and Kashmir', 'Jammu', null, 32.76, 74.89, false),
  ('Q48728412', 'Barnoti', 'Jammu and Kashmir', 'Kathua', null, 32.43, 75.43, false),
  ('Q2597901', 'Kathua', 'Jammu and Kashmir', 'Kathua', 51991, 33.37, 75.52, false),
  ('Q48728459', 'Mahanpur', 'Jammu and Kashmir', 'Kathua', null, 32.54, 75.64, false),
  ('Q104845911', 'Bunjwah', 'Jammu and Kashmir', 'Kishtwar', 15899, 33.1402, 75.9361, false),
  ('Q24907418', 'Devsar', 'Jammu and Kashmir', 'Kulgam', null, 33.65, 75.02, false),
  ('Q83661', 'Kulgam', 'Jammu and Kashmir', 'Kulgam', 23584, 33.64, 75.02, false),
  ('Q63066', 'Qazigund', 'Jammu and Kashmir', 'Kulgam', null, 33.5925, 75.1656, false),
  ('Q720828', 'Handwara', 'Jammu and Kashmir', 'Kupwara', 269311, 34.4, 74.28, false),
  ('Q48725623', 'Ari', 'Jammu and Kashmir', 'Poonch', null, 33.57, 74.18, false),
  ('Q2575156', 'Poonch', 'Jammu and Kashmir', 'Poonch', null, 33.7667, 74.1, false),
  ('Q584971', 'Awantipora', 'Jammu and Kashmir', 'Pulwama', null, 33.9197, 75.0153, false),
  ('Q2558539', 'Pampore', 'Jammu and Kashmir', 'Pulwama', null, 34.02, 74.93, false),
  ('Q1949395', 'Rajauri', 'Jammu and Kashmir', 'Rajouri', 41552, 33.38, 74.3, false),
  ('Q720851', 'Thanamandi', 'Jammu and Kashmir', 'Rajouri', null, 33.5419, 74.3811, false),
  ('Q2575938', 'Shopian', 'Jammu and Kashmir', 'Shopian', 16360, 33.72, 74.83, false),
  ('Q31213669', 'Hawal', 'Jammu and Kashmir', 'Srinagar', null, 34.1048, 74.81, false),
  ('Q170115', 'Srinagar', 'Jammu and Kashmir', 'Srinagar', 1180570, 34.0911, 74.8061, false),
  ('Q1938135', 'Udhampur', 'Jammu and Kashmir', 'Udhampur', 35507, 32.93, 75.13, false),
  ('Q61927260', 'Bhalwal', 'Jammu and Kashmir', null, null, 32.8094, 74.7683, false),
  ('Q61927150', 'Raipur Domana', 'Jammu and Kashmir', null, null, 32.788, 74.7785, false),
  ('Q48725956', 'Bandh Dih', 'Jharkhand', 'Bokaro', null, 23.6653, 86.0162, false),
  ('Q861827', 'Bokaro Steel City', 'Jharkhand', 'Bokaro', null, 23.67, 86.15, false),
  ('Q886561', 'Chas', 'Jharkhand', 'Bokaro', null, 23.63, 86.17, false),
  ('Q1626646', 'Jena', 'Jharkhand', 'Bokaro', null, 23.68, 86.02, false),
  ('Q30591336', 'Lakshipur', 'Jharkhand', 'Bokaro', null, 23.4764, 86.359, false),
  ('Q48726905', 'Lalpania', 'Jharkhand', 'Bokaro', null, 23.7415, 85.7454, false),
  ('Q106741541', 'Sijua, Bokaro', 'Jharkhand', 'Bokaro', null, 23.7692, 86.1673, false),
  ('Q1192453', 'Deoghar', 'Jharkhand', 'Deoghar', 203116, 24.48, 86.7, false),
  ('Q48727309', 'Baliapur', 'Jharkhand', 'Dhanbad', null, 23.7278, 86.5262, false),
  ('Q244159', 'Dhanbad', 'Jharkhand', 'Dhanbad', null, 23.7928, 86.435, false),
  ('Q1389472', 'Dumka', 'Jharkhand', 'Dumka', null, 24.27, 87.25, false),
  ('Q104869091', 'Purana Dumka', 'Jharkhand', 'Dumka', null, 24.2564, 87.2373, false),
  ('Q5521845', 'Garabasa', 'Jharkhand', 'East Singhbhum', null, 22.7692, 86.1931, false),
  ('Q200054', 'Jamshedpur', 'Jharkhand', 'East Singhbhum', 1558000, 22.8, 86.1833, false),
  ('Q104880326', 'Akdoni Khurd', 'Jharkhand', 'Giridih', null, 24.1704, 86.2792, false),
  ('Q104880457', 'Dandidih', 'Jharkhand', 'Giridih', null, 24.1634, 86.3052, false),
  ('Q104880507', 'Pertodih', 'Jharkhand', 'Giridih', null, 24.1534, 86.3152, false),
  ('Q104880121', 'Sirsia', 'Jharkhand', 'Giridih', null, 24.2054, 86.2932, false),
  ('Q104879960', 'Telodih', 'Jharkhand', 'Giridih', null, 24.2016, 86.2576, false),
  ('Q31213671', 'Poraiyahat', 'Jharkhand', 'Godda', null, 24.6781, 87.1719, false),
  ('Q104876401', 'Sarauni', 'Jharkhand', 'Godda', null, 24.8143, 87.3242, false),
  ('Q1708042', 'Gumla', 'Jharkhand', 'Gumla', 80129, 23.0444, 84.5417, false),
  ('Q48728638', 'Bishnugarh', 'Jharkhand', 'Hazaribagh', null, 24.0243, 85.7404, false),
  ('Q48728796', 'Charhi', 'Jharkhand', 'Hazaribagh', null, 23.8762, 85.4452, false),
  ('Q105334649', 'Cherra, Hazaribagh', 'Jharkhand', 'Hazaribagh', null, 24.0143, 85.7494, false),
  ('Q1924589', 'Dari', 'Jharkhand', 'Hazaribagh', null, 23.8283, 85.2739, false),
  ('Q1024667', 'Hazaribagh', 'Jharkhand', 'Hazaribagh', 153595, 23.98, 85.35, false),
  ('Q48728844', 'Urimari', 'Jharkhand', 'Hazaribagh', null, 23.6983, 85.3131, false),
  ('Q2594860', 'Jamtara', 'Jharkhand', 'Jamtara', null, 23.95, 86.8, false),
  ('Q104834708', 'Bekobar', 'Jharkhand', 'Koderma', 7184, 24.4308, 85.5895, false),
  ('Q104835027', 'Domchanch', 'Jharkhand', 'Koderma', null, 24.4731, 85.6897, false),
  ('Q104875060', 'Raghunandanpur', 'Jharkhand', 'Pakur', null, 24.6383, 87.8839, false),
  ('Q104875013', 'Sagarmpur', 'Jharkhand', 'Pakur', null, 24.6703, 87.8487, false),
  ('Q976908', 'Hussainabad', 'Jharkhand', 'Palamu', null, 24.5285, 84.0, false),
  ('Q936464', 'Medininagar', 'Jharkhand', 'Palamu', 78396, 24.0333, 84.0667, false),
  ('Q108822343', 'Irba', 'Jharkhand', 'Ranchi', null, 23.4574, 85.4424, false),
  ('Q174461', 'Ranchi', 'Jharkhand', 'Ranchi', 1073440, 23.3556, 85.3347, false),
  ('Q2355927', 'Rajmahal', 'Jharkhand', 'Sahebganj', 17974, 25.05, 87.84, false),
  ('Q104875815', 'Tin Pahar', 'Jharkhand', 'Sahebganj', null, 25.0002, 87.7408, false),
  ('Q490645', 'Adityapur', 'Jharkhand', 'Seraikela Kharsawan', 174355, 22.7808, 86.1522, false),
  ('Q278913', 'Chakradharpur', 'Jharkhand', 'West Singhbhum', 197953, 22.7, 85.63, false),
  ('Q25247801', 'Bachra', 'Jharkhand', null, null, 23.6886, 85.0703, false),
  ('Q24938661', 'Chitarpur', 'Jharkhand', null, null, 23.5794, 85.6548, false),
  ('Q48727295', 'Hariharpur, Dhanbad', 'Jharkhand', null, null, 23.8965, 86.1287, false),
  ('Q614401', 'Khunti', 'Jharkhand', null, 29271, 23.014, 85.2724, false),
  ('Q2483929', 'Simdega', 'Jharkhand', null, 80129, 22.62, 84.52, false),
  ('Q25247811', 'Tenu', 'Jharkhand', null, null, 23.7344, 85.8406, false),
  ('Q590751', 'Badami', 'Karnataka', 'Bagalkot', null, 15.9149, 75.6768, false),
  ('Q520858', 'Bagalkot', 'Karnataka', 'Bagalkot', null, 16.1833, 75.7, false),
  ('Q15277648', 'Sidlaphadi', 'Karnataka', 'Bagalkot', null, 15.9436, 75.7014, false),
  ('Q429063', 'Ballari', 'Karnataka', 'Ballari', 410445, 15.15, 76.9333, false),
  ('Q429171', 'Tekkalakote', 'Karnataka', 'Ballari', null, 15.5348, 76.8785, false),
  ('Q270176', 'Belgaum', 'Karnataka', 'Belagavi', 488157, 15.8569, 74.5044, false),
  ('Q1105246', 'Chikodi', 'Karnataka', 'Belagavi', null, 16.43, 74.6, false),
  ('Q1708149', 'Gokak', 'Karnataka', 'Belagavi', null, 16.169, 74.8239, false),
  ('Q2222560', 'Halasi', 'Karnataka', 'Belagavi', null, 15.63, 74.52, false),
  ('Q3595139', 'Hooli', 'Karnataka', 'Belagavi', null, 15.7833, 75.1167, false),
  ('Q1755404', 'Hukeri', 'Karnataka', 'Belagavi', null, 16.23, 74.6, false),
  ('Q2120803', 'Khanapur', 'Karnataka', 'Belagavi', null, 15.6394, 74.5083, false),
  ('Q2282286', 'Saundatti', 'Karnataka', 'Belagavi', null, 15.7833, 75.1167, false),
  ('Q4853963', 'Banaswadi', 'Karnataka', 'Bengaluru', null, 13.015, 77.652, false),
  ('Q2087756', 'Devanahalli', 'Karnataka', 'Bengaluru North', null, 13.23, 77.7, false),
  ('Q1264006', 'Doddaballapura', 'Karnataka', 'Bengaluru North', null, 13.292, 77.543, false),
  ('Q24943409', 'Tubagere', 'Karnataka', 'Bengaluru North', null, 13.292, 77.543, false),
  ('Q3466512', 'Arekere', 'Karnataka', 'Bengaluru Urban', null, 12.89, 77.6, false),
  ('Q1531304', 'Basavanagudi', 'Karnataka', 'Bengaluru Urban', null, 12.94, 77.57, false),
  ('Q4880636', 'Begur', 'Karnataka', 'Bengaluru Urban', null, 12.8723, 77.6329, false),
  ('Q1355', 'Bengaluru', 'Karnataka', 'Bengaluru Urban', 12327000, 12.9791, 77.5913, true),
  ('Q4741433', 'Chamrajpet', 'Karnataka', 'Bengaluru Urban', null, 12.95, 77.55, false),
  ('Q4801619', 'Hulimavu', 'Karnataka', 'Bengaluru Urban', null, 12.87, 77.6, false),
  ('Q2174631', 'Jigani', 'Karnataka', 'Bengaluru Urban', null, 12.46, 77.38, false),
  ('Q5383113', 'Vidyaranyapura', 'Karnataka', 'Bengaluru Urban', null, 13.076, 77.558, false),
  ('Q712521', 'Basavakalyan', 'Karnataka', 'Bidar', null, 17.87, 76.95, false),
  ('Q461922', 'Bidar', 'Karnataka', 'Bidar', 172298, 17.9, 77.55, false),
  ('Q2747508', 'Chamarajanagar', 'Karnataka', 'Chamarajanagar', 60810, 11.9236, 76.94, false),
  ('Q1708600', 'Gundlupet', 'Karnataka', 'Chamarajanagar', null, 11.8, 76.68, false),
  ('Q2238928', 'Kollegal', 'Karnataka', 'Chamarajanagar', null, 12.0628, 76.9777, false),
  ('Q2475035', 'Yelandur', 'Karnataka', 'Chamarajanagar', null, 12.07, 77.03, false),
  ('Q46415', 'Chitradurga', 'Karnataka', 'Chitradurga', null, 14.2333, 76.4, false),
  ('Q6414110', 'Kinnigoli', 'Karnataka', 'Dakshina Kannada', null, 13.0631, 74.8473, false),
  ('Q127041', 'Mangaluru', 'Karnataka', 'Dakshina Kannada', 623841, 12.8717, 74.8425, false),
  ('Q1949058', 'Moodubidire', 'Karnataka', 'Dakshina Kannada', null, 13.08, 74.98, false),
  ('Q2558126', 'Mulki', 'Karnataka', 'Dakshina Kannada', null, 13.1, 74.8, false),
  ('Q1089504', 'Puttur', 'Karnataka', 'Dakshina Kannada', null, 12.77, 75.22, false),
  ('Q584295', 'Udupi', 'Karnataka', 'Dakshina Kannada', 165401, 13.3322, 74.7461, false),
  ('Q2738747', 'Ullal', 'Karnataka', 'Dakshina Kannada', null, 12.817, 74.8414, false),
  ('Q7899093', 'Uppinangady', 'Karnataka', 'Dakshina Kannada', null, 12.77, 75.22, false),
  ('Q7937138', 'Vitla', 'Karnataka', 'Dakshina Kannada', null, 12.766, 75.122, false),
  ('Q519486', 'Davangere', 'Karnataka', 'Davanagere', null, 14.4667, 75.9167, false),
  ('Q2761728', 'Dharwad', 'Karnataka', 'Dharwad', null, 15.459, 75.0078, false),
  ('Q522115', 'Gadag-Betageri', 'Karnataka', 'Gadag', 172813, 15.4167, 75.6167, false),
  ('Q15226691', 'Hulkoti', 'Karnataka', 'Gadag', null, 15.4333, 75.5333, false),
  ('Q6092375', 'Itagi, Gadag', 'Karnataka', 'Gadag', null, 15.7381, 75.8247, false),
  ('Q760603', 'Belur', 'Karnataka', 'Hassan', 20225, 13.1642, 75.8647, false),
  ('Q886632', 'Channarayapatna', 'Karnataka', 'Hassan', 40400, 12.9, 76.39, false),
  ('Q1013556', 'Halebidu', 'Karnataka', 'Hassan', null, 13.2169, 75.9917, false),
  ('Q47264', 'Hassan', 'Karnataka', 'Hassan', 133436, 13.005, 76.1028, false),
  ('Q14227687', 'Nuggehalli', 'Karnataka', 'Hassan', null, 13.011, 76.475, false),
  ('Q1026193', 'Shravanabelagola', 'Karnataka', 'Hassan', null, 12.8571, 76.4872, false),
  ('Q1122693', 'Shiggaon', 'Karnataka', 'Haveri', null, 14.9906, 75.225, false),
  ('Q37112', 'Kalaburagi', 'Karnataka', 'Kalaburgi', null, 17.3333, 76.8333, false),
  ('Q2571884', 'Virajpet', 'Karnataka', 'Kodagu', null, 12.1964, 75.805, false),
  ('Q1023689', 'Chikkaballapur', 'Karnataka', 'Kolar', null, 13.4342, 77.7242, false),
  ('Q727181', 'Kolar', 'Karnataka', 'Kolar', 138462, 13.1333, 78.1333, false),
  ('Q2552087', 'Srinivaspur', 'Karnataka', 'Kolar', null, 13.33, 78.22, false),
  ('Q126418761', 'Munirabad Project Area', 'Karnataka', 'Koppal', null, 15.31, 76.33, false),
  ('Q1006277', 'Mandya', 'Karnataka', 'Mandya', 131211, 12.5242, 76.8958, false),
  ('Q10086', 'Mysore', 'Karnataka', 'Mysuru', 920550, 12.3086, 76.6531, false),
  ('Q2475042', 'Nanjangud', 'Karnataka', 'Mysuru', null, 12.12, 76.68, false),
  ('Q2887927', 'Somanathapura', 'Karnataka', 'Mysuru', null, 12.2758, 76.8816, false),
  ('Q16341199', 'Prasadampadu', 'Karnataka', 'NTR', 13941, 16.5167, 80.6833, false),
  ('Q916838', 'Raichur', 'Karnataka', 'Raichur', null, 16.2, 77.3506, false),
  ('Q281796', 'Shimoga', 'Karnataka', 'Shimoga', null, 13.9167, 75.5667, false),
  ('Q911310', 'Tumkur', 'Karnataka', 'Tumkur', null, 13.3422, 77.1017, false),
  ('Q8045728', 'Y.N. Hosakote', 'Karnataka', 'Tumkur', 12593, 14.276, 77.1683, false),
  ('Q3595293', 'Baindur', 'Karnataka', 'Udupi', null, 13.866, 74.6333, false),
  ('Q15233595', 'Kapu', 'Karnataka', 'Udupi', null, 13.49, 74.7, false),
  ('Q2284508', 'Karkala', 'Karnataka', 'Udupi', null, 13.2, 74.98, false),
  ('Q7418891', 'Sanoor', 'Karnataka', 'Udupi', 6328, 13.1658, 74.9933, false),
  ('Q5102349', 'Chitrapur', 'Karnataka', 'Uttara Kannada', null, 14.0343, 74.5323, false),
  ('Q2727978', 'Karwar', 'Karnataka', 'Uttara Kannada', null, 14.8136, 74.1297, false),
  ('Q48727106', 'Hampi', 'Karnataka', 'Vijayanagara', 2777, 15.335, 76.462, false),
  ('Q33414', 'Hosapete', 'Karnataka', 'Vijayanagara', null, 15.2667, 76.4, false),
  ('Q3812660', 'Kamalapura', 'Karnataka', 'Vijayanagara', null, 15.306, 76.477, false),
  ('Q3636023', 'Vijayapura', 'Karnataka', 'Vijaypura', 327427, 16.8244, 75.7154, false),
  ('Q1706530', 'Gurmitkal', 'Karnataka', null, null, 16.8664, 77.3908, false),
  ('Q4801570', 'Hebbal', 'Karnataka', null, null, 13.04, 77.59, false),
  ('Q5695940', 'Hebri', 'Karnataka', null, null, 13.4667, 74.9833, false),
  ('Q6031819', 'Ingaleshwara', 'Karnataka', null, null, 16.59, 75.96, false),
  ('Q13371953', 'Ramanagara', 'Karnataka', null, null, 12.7167, 77.3, false),
  ('Q30716479', 'Sindhagatta', 'Karnataka', null, null, 12.6986, 76.5511, false),
  ('Q13110291', 'Alappuzha Municipality', 'Kerala', 'Alappuzha', 177079, 9.4941, 76.3439, false),
  ('Q13112000', 'Chengannur Municipality', 'Kerala', 'Alappuzha', 25391, 9.32, 76.6215, false),
  ('Q13112080', 'Cherthala Municipality', 'Kerala', 'Alappuzha', 45102, 9.6867, 76.3426, false),
  ('Q16137901', 'Haripad Municipality', 'Kerala', 'Alappuzha', null, 9.2937, 76.4625, false),
  ('Q13111162', 'Kayamkulam Municipality', 'Kerala', 'Alappuzha', 65299, 9.1777, 76.5068, false),
  ('Q13114048', 'Mavelikara Municipality', 'Kerala', 'Alappuzha', 28440, 9.2517, 76.5493, false),
  ('Q2283384', 'Mavelikkara', 'Kerala', 'Alappuzha', null, 9.2592, 76.5564, false),
  ('Q16136960', 'Aluva Municipality', 'Kerala', 'Ernakulam', 24108, 10.6, 76.21, false),
  ('Q13109811', 'Angamaly Municipality', 'Kerala', 'Ernakulam', 33424, 10.11, 76.22, false),
  ('Q886572', 'Chengamanad', 'Kerala', 'Ernakulam', null, 10.1651, 76.3623, false),
  ('Q2962705', 'Cherai', 'Kerala', 'Ernakulam', null, 10.142, 76.1796, false),
  ('Q5105411', 'Chottanikkara', 'Kerala', 'Ernakulam', null, 9.933, 76.391, false),
  ('Q13110777', 'Eloor Municipality', 'Kerala', 'Ernakulam', null, 10.0684, 76.3092, false),
  ('Q5600503', 'Greater Cochin', 'Kerala', 'Ernakulam', null, 9.9667, 76.25, false),
  ('Q16134131', 'Kalamassery Municipality', 'Kerala', 'Ernakulam', 63176, 10.11, 76.22, false),
  ('Q1800', 'Kochi', 'Kerala', 'Ernakulam', 677381, 9.9667, 76.2833, false),
  ('Q13111405', 'Koothattukulam Municipality', 'Kerala', 'Ernakulam', null, 9.8602, 76.5804, false),
  ('Q25585458', 'Kothamangalam Municipality', 'Kerala', 'Ernakulam', 37169, 10.11, 76.22, false),
  ('Q6444923', 'Kunnathunad', 'Kerala', 'Ernakulam', null, 10.0333, 76.5167, false),
  ('Q6444944', 'Kunnukara', 'Kerala', 'Ernakulam', null, 10.15, 76.3, false),
  ('Q6447388', 'Kurumbakkavu Bhagavathy Temple Edathala', 'Kerala', 'Ernakulam', null, 10.0672, 76.365, false),
  ('Q17071930', 'Manjaly', 'Kerala', 'Ernakulam', null, 10.1667, 76.2167, false),
  ('Q139589463', 'Manjummel', 'Kerala', 'Ernakulam', null, 10.08, 76.5, false),
  ('Q13113869', 'Maradu Municipality', 'Kerala', 'Ernakulam', null, 9.9329, 76.3225, false),
  ('Q12062155', 'Mulanthuruthy', 'Kerala', 'Ernakulam', null, 9.9008, 76.39, false),
  ('Q20582999', 'Muvattupuzha Municipality', 'Kerala', 'Ernakulam', 27595, 9.9872, 76.5782, false),
  ('Q3595582', 'North Paravur', 'Kerala', 'Ernakulam', null, 10.15, 76.23, false),
  ('Q13114499', 'North Paravur Municipality', 'Kerala', 'Ernakulam', 30056, 10.1407, 76.2355, false),
  ('Q13113462', 'Perumbavoor Municipality', 'Kerala', 'Ernakulam', 26550, 10.1112, 76.4924, false),
  ('Q13113292', 'Piravom Municipality', 'Kerala', 'Ernakulam', null, 9.8714, 76.4944, false),
  ('Q7262219', 'Puthencruz', 'Kerala', 'Ernakulam', null, 9.9667, 76.4167, false),
  ('Q13112589', 'Thrikkakara Municipality', 'Kerala', 'Ernakulam', null, 10.21, 76.2, false),
  ('Q16137804', 'Tripunithura Municipality', 'Kerala', 'Ernakulam', 59881, 9.9518, 76.3514, false),
  ('Q7877007', 'Udayamperoor', 'Kerala', 'Ernakulam', null, 9.9139, 76.3633, false),
  ('Q2552193', 'Varappuzha', 'Kerala', 'Ernakulam', null, 10.1113, 76.2576, false),
  ('Q5353509', 'Elappara', 'Kerala', 'Idukki', null, 9.6167, 76.9667, false),
  ('Q12060936', 'Kalayanthani', 'Kerala', 'Idukki', null, 9.9, 76.717, false),
  ('Q13110924', 'Kattappana Municipality', 'Kerala', 'Idukki', null, 9.7419, 77.1086, false),
  ('Q1025124', 'Munnar', 'Kerala', 'Idukki', null, 10.0892, 77.0597, false),
  ('Q1025278', 'Painavu', 'Kerala', 'Idukki', 11014, 9.8494, 76.9431, false),
  ('Q2568281', 'Thodupuzha', 'Kerala', 'Idukki', null, 9.9, 76.717, false),
  ('Q16133845', 'Thodupuzha Municipality', 'Kerala', 'Idukki', 46226, 9.9, 76.717, false),
  ('Q25588003', 'Anthoor Municipality', 'Kerala', 'Kannur', null, 11.9866, 75.3714, false),
  ('Q5068531', 'Chalad', 'Kerala', 'Kannur', null, 11.8667, 75.3833, false),
  ('Q5092623', 'Cherupuzha, Kannur', 'Kerala', 'Kannur', null, 12.2728, 75.3672, false),
  ('Q13111976', 'Chungakkunnu', 'Kerala', 'Kannur', null, 11.889, 75.828, false),
  ('Q25588302', 'Iritty Municipality', 'Kerala', 'Kannur', null, 11.9611, 75.6431, false),
  ('Q16134585', 'Jagannath Temple, Thalassery', 'Kerala', 'Kannur', null, 11.7373, 75.5083, false),
  ('Q4789666', 'Kannur', 'Kerala', 'Kannur', null, 11.8689, 75.3556, false),
  ('Q16136988', 'Kuthuparamba Municipality', 'Kerala', 'Kannur', 28907, 11.83, 75.58, false),
  ('Q277480', 'Mahé', 'Kerala', 'Kannur', 36828, 11.7011, 75.5367, false),
  ('Q4310785', 'Mambaram', 'Kerala', 'Kannur', null, 11.822, 75.5111, false),
  ('Q2475713', 'Mattannur', 'Kerala', 'Kannur', null, 11.93, 75.5725, false),
  ('Q13113792', 'Mattanur Municipality', 'Kerala', 'Kannur', 44317, 11.9167, 75.5833, false),
  ('Q2568336', 'Panoor Municipality', 'Kerala', 'Kannur', null, 11.7233, 75.5856, false),
  ('Q7136011', 'Parassinikkadavu', 'Kerala', 'Kannur', null, 11.983, 75.4021, false),
  ('Q16137435', 'Payyannur Municipality', 'Kerala', 'Kannur', 68711, 12.1, 75.2, false),
  ('Q7156679', 'Pazhayangadi', 'Kerala', 'Kannur', null, 12.0167, 75.2597, false),
  ('Q7166963', 'Peravoor', 'Kerala', 'Kannur', null, 11.9001, 75.732, false),
  ('Q48732015', 'Poolakutty', 'Kerala', 'Kannur', null, 11.8512, 75.7725, false),
  ('Q7585699', 'Sreekandapuram', 'Kerala', 'Kannur', null, 12.0333, 75.5, false),
  ('Q16134783', 'Sreekandapuram Municipality', 'Kerala', 'Kannur', null, 11.86, 75.3455, false),
  ('Q13112422', 'Thalassery Municipality', 'Kerala', 'Kannur', 99386, 11.75, 75.49, false),
  ('Q16136859', 'Thalipparamba Municipality', 'Kerala', 'Kannur', 67441, 12.0305, 75.357, false),
  ('Q7841948', 'Trikarpur', 'Kerala', 'Kannur', null, 12.2167, 75.25, false),
  ('Q2720800', 'Valapattanam', 'Kerala', 'Kannur', null, 11.9153, 75.3475, false),
  ('Q4854312', 'Bandadka', 'Kerala', 'Kasaragod', null, 12.5015, 75.2676, false),
  ('Q5091276', 'Chengala', 'Kerala', 'Kasaragod', null, 12.5087, 75.0558, false),
  ('Q5092642', 'Cheruvathur', 'Kerala', 'Kasaragod', null, 12.3167, 75.083, false),
  ('Q720627', 'Kanhangad', 'Kerala', 'Kasaragod', null, 12.3, 75.0833, false),
  ('Q20576121', 'Kanhangad Municipality', 'Kerala', 'Kasaragod', 65499, 12.32, 75.09, false),
  ('Q317217', 'Kasaragod', 'Kerala', 'Kasaragod', 52683, 12.5014, 74.99, false),
  ('Q13111219', 'Kasaragod Municipality', 'Kerala', 'Kasaragod', 52683, 12.4937, 74.9959, false),
  ('Q20164600', 'Mulleria, Kasaragod', 'Kerala', 'Kasaragod', null, 12.33, 75.95, false),
  ('Q13112956', 'Nileshwar Municipality', 'Kerala', 'Kasaragod', null, 12.256, 75.08, false),
  ('Q12064134', 'Nileshwaram', 'Kerala', 'Kasaragod', null, 12.2594, 75.1353, false),
  ('Q24906390', 'Perla, Kasaragod', 'Kerala', 'Kasaragod', null, 12.57, 74.98, false),
  ('Q316209', 'Uppala', 'Kerala', 'Kasaragod', null, 12.683, 74.9, false),
  ('Q24948631', 'Vidyanagar, Kasaragod', 'Kerala', 'Kasaragod', null, 12.5174, 75.0125, false),
  ('Q5070954', 'Chandanathoppe', 'Kerala', 'Kollam', null, 8.9299, 76.6418, false),
  ('Q16133703', 'Karunagappally Municipality', 'Kerala', 'Kollam', null, 9.045, 76.5235, false),
  ('Q321475', 'Kollam', 'Kerala', 'Kollam', 397419, 8.8853, 76.5864, false),
  ('Q13111612', 'Kottarakara Municipality', 'Kerala', 'Kollam', null, 8.9917, 76.7785, false),
  ('Q719744', 'Kottarakkara', 'Kerala', 'Kollam', null, 8.9833, 76.7667, false),
  ('Q1939468', 'Paravur', 'Kerala', 'Kollam', null, 8.78, 76.7, false),
  ('Q16137553', 'Paravur Municipality', 'Kerala', 'Kollam', 38649, 8.8168, 76.6719, false),
  ('Q7144693', 'Pathanapuram', 'Kerala', 'Kollam', null, 9.0861, 76.8692, false),
  ('Q16898801', 'Pozhikara', 'Kerala', 'Kollam', null, 8.8108, 76.6522, false),
  ('Q742720', 'Punalur', 'Kerala', 'Kollam', null, 9.0176, 76.9265, false),
  ('Q13113355', 'Punalur Municipality', 'Kerala', 'Kollam', 47226, 9.0042, 76.9254, false),
  ('Q1941617', 'Athirampuzha', 'Kerala', 'Kottayam', null, 9.6595, 76.5267, false),
  ('Q65666408', 'Changanassery Municipality', 'Kerala', 'Kottayam', 51960, 9.4436, 76.5423, false),
  ('Q16133859', 'Erattupetta Municipality', 'Kerala', 'Kottayam', null, 9.6904, 76.7758, false),
  ('Q13110767', 'Ettumanoor Municipality', 'Kerala', 'Kottayam', null, 9.6571, 76.5723, false),
  ('Q6363485', 'Kanjirappally', 'Kerala', 'Kottayam', null, 9.55, 76.7833, false),
  ('Q1531311', 'Karukachal', 'Kerala', 'Kottayam', null, 9.5, 76.6333, false),
  ('Q672672', 'Kayamkulam', 'Kerala', 'Kottayam', null, 9.17, 76.49, false),
  ('Q6427202', 'Kolenchery', 'Kerala', 'Kottayam', null, 9.983, 76.4764, false),
  ('Q659887', 'Kottayam', 'Kerala', 'Kottayam', null, 9.5917, 76.5222, false),
  ('Q13111690', 'Kottayam Municipality', 'Kerala', 'Kottayam', 60725, 9.5736, 76.5139, false),
  ('Q6445674', 'Kuravilangad', 'Kerala', 'Kottayam', null, 9.75, 76.55, false),
  ('Q6746958', 'Manarcaud', 'Kerala', 'Kottayam', null, 9.6125, 76.5833, false),
  ('Q20581246', 'Pala Municipality', 'Kerala', 'Kottayam', 22640, 9.7056, 76.6806, false),
  ('Q14473625', 'Poonjar', 'Kerala', 'Kottayam', null, 9.6744, 76.8087, false),
  ('Q2477208', 'Vaikom', 'Kerala', 'Kottayam', null, 9.7667, 76.4, false),
  ('Q16133934', 'Vaikom Municipality', 'Kerala', 'Kottayam', 22637, 9.7463, 76.3968, false),
  ('Q4853091', 'Balussery', 'Kerala', 'Kozhikode', null, 11.45, 75.83, false),
  ('Q13113570', 'Feroke Municipality', 'Kerala', 'Kozhikode', null, 11.1715, 75.8339, false),
  ('Q13111608', 'Koduvally Municipality', 'Kerala', 'Kozhikode', null, 11.3594, 75.9111, false),
  ('Q18126948', 'Kovoor Town', 'Kerala', 'Kozhikode', null, 11.3064, 75.8789, false),
  ('Q2720777', 'Koyilandy', 'Kerala', 'Kozhikode', null, 11.43, 75.7, false),
  ('Q13111636', 'Koyilandy Municipality', 'Kerala', 'Kozhikode', 68982, 11.45, 75.706, false),
  ('Q28729', 'Kozhikode', 'Kerala', 'Kozhikode', 609224, 11.2478, 75.7803, false),
  ('Q6444914', 'Kunnamangalam', 'Kerala', 'Kozhikode', null, 11.3064, 75.8789, false),
  ('Q6734209', 'Mahlkot', 'Kerala', 'Kozhikode', null, 11.1655, 75.8151, false),
  ('Q2475602', 'Mavoor', 'Kerala', 'Kozhikode', null, 11.2597, 75.9486, false),
  ('Q6933547', 'Mukkam', 'Kerala', 'Kozhikode', null, 11.3, 75.975, false),
  ('Q13114107', 'Mukkam Municipality', 'Kerala', 'Kozhikode', null, 11.3335, 75.9813, false),
  ('Q721370', 'Pantheeramkavu', 'Kerala', 'Kozhikode', null, 11.3268, 75.8906, false),
  ('Q3523165', 'Payyoli', 'Kerala', 'Kozhikode', null, 11.5152, 75.6253, false),
  ('Q16137491', 'Payyoli Municipality', 'Kerala', 'Kozhikode', null, 11.5352, 75.6208, false),
  ('Q13114361', 'Ramanattukara Municipality', 'Kerala', 'Kozhikode', null, 11.1868, 75.8626, false),
  ('Q7785500', 'Thiruvambady', 'Kerala', 'Kozhikode', null, 11.3608, 76.0089, false),
  ('Q7796941', 'Thottilpalam', 'Kerala', 'Kozhikode', null, 11.6775, 75.78, false),
  ('Q13114484', 'Vadakara Municipality', 'Kerala', 'Kozhikode', 68970, 11.5906, 75.6011, false),
  ('Q5090583', 'Chemmad', 'Kerala', 'Malappuram', null, 11.0333, 75.9, false),
  ('Q5335694', 'Edapal', 'Kerala', 'Malappuram', null, 10.7321, 76.0274, false),
  ('Q5335723', 'Edavannappara', 'Kerala', 'Malappuram', null, 11.25, 75.95, false),
  ('Q6352691', 'Kalikavu', 'Kerala', 'Malappuram', null, 11.172, 76.3211, false),
  ('Q6371052', 'Karinkallathani', 'Kerala', 'Malappuram', null, 10.9537, 76.3207, false),
  ('Q16135084', 'Kondotty Municipality', 'Kerala', 'Malappuram', null, 11.1344, 75.9777, false),
  ('Q6434267', 'Kottakkal', 'Kerala', 'Malappuram', null, 10.9995, 76.002, false),
  ('Q13111679', 'Kottakkal Municipality', 'Kerala', 'Malappuram', null, 10.9846, 76.0231, false),
  ('Q956893', 'Malappuram', 'Kerala', 'Malappuram', null, 11.0417, 76.0794, false),
  ('Q16135157', 'Malappuram Municipality', 'Kerala', 'Malappuram', 75740, 11.03, 76.05, false),
  ('Q6745953', 'Mampad', 'Kerala', 'Malappuram', null, 11.1437, 76.1119, false),
  ('Q2568380', 'Manjeri', 'Kerala', 'Malappuram', null, 11.12, 76.12, false),
  ('Q16134188', 'Manjeri Municipality', 'Kerala', 'Malappuram', 53650, 11.1197, 76.131, false),
  ('Q6778020', 'Marutha', 'Kerala', 'Malappuram', null, 11.4281, 76.3268, false),
  ('Q16135735', 'Nilambur Municipality', 'Kerala', 'Malappuram', null, 11.2878, 76.2337, false),
  ('Q7135756', 'Parappanangadi Municipality', 'Kerala', 'Malappuram', null, 11.0497, 75.8575, false),
  ('Q13113443', 'Perinthalmanna Municipality', 'Kerala', 'Malappuram', 87356, 10.98, 76.23, false),
  ('Q13113491', 'Ponnani Municipality', 'Kerala', 'Malappuram', 83704, 10.7731, 75.9478, false),
  ('Q18346018', 'Puthanathani', 'Kerala', 'Malappuram', null, 10.9347, 76.0042, false),
  ('Q13112429', 'Tanur Municipality', 'Kerala', 'Malappuram', null, 10.9811, 75.8792, false),
  ('Q7809362', 'Tirunavaya', 'Kerala', 'Malappuram', null, 11.001, 75.9911, false),
  ('Q2722267', 'Tirur', 'Kerala', 'Malappuram', null, 10.9167, 75.9245, false),
  ('Q13112532', 'Tirur Municipality', 'Kerala', 'Malappuram', 58490, 10.9162, 75.9256, false),
  ('Q3595478', 'Tirurangadi', 'Kerala', 'Malappuram', null, 11.05, 75.93, false),
  ('Q20579667', 'Tirurangadi Municipality', 'Kerala', 'Malappuram', null, 11.0313, 75.9184, false),
  ('Q13114610', 'Valanchery Municipality', 'Kerala', 'Malappuram', null, 10.8962, 76.0644, false),
  ('Q7915040', 'Vaniyambalam', 'Kerala', 'Malappuram', null, 11.1833, 76.2583, false),
  ('Q5092251', 'Cherpulassery', 'Kerala', 'Palakkad', null, 10.8793, 76.3148, false),
  ('Q13112063', 'Cherpulassery Municipality', 'Kerala', 'Palakkad', null, 10.87, 76.31, false),
  ('Q16137852', 'Chittur Tattamangalam Municipality', 'Kerala', 'Palakkad', 130736, 10.6931, 76.7188, false),
  ('Q5335714', 'Edathatuttara', 'Kerala', 'Palakkad', null, 11.05, 76.35, false),
  ('Q16135019', 'Koduvayur', 'Kerala', 'Palakkad', 25927, 10.6711, 76.6479, false),
  ('Q23307880', 'Mannarkad Municipality', 'Kerala', 'Palakkad', null, 10.9865, 76.4579, false),
  ('Q16893428', 'Mundur', 'Kerala', 'Palakkad', null, 10.8333, 76.5833, false),
  ('Q6991185', 'Nemmara', 'Kerala', 'Palakkad', null, 10.5833, 76.6, false),
  ('Q2568304', 'Ottapalam', 'Kerala', 'Palakkad', null, 10.77, 76.38, false),
  ('Q13110826', 'Ottapalam Municipality', 'Kerala', 'Palakkad', 42022, 10.7835, 76.3855, false),
  ('Q1006240', 'Palakkad', 'Kerala', 'Palakkad', 130955, 10.7792, 76.6547, false),
  ('Q20581178', 'Palakkad Municipality', 'Kerala', 'Palakkad', 44613, 10.7779, 76.6543, false),
  ('Q3370142', 'Pattambi', 'Kerala', 'Palakkad', null, 10.82, 76.2, false),
  ('Q16136794', 'Pattambi Municipality', 'Kerala', 'Palakkad', null, 10.8145, 76.1883, false),
  ('Q2568315', 'Ponnani', 'Kerala', 'Palakkad', null, 10.7677, 75.9259, false),
  ('Q13114977', 'Shoranur Municipality', 'Kerala', 'Palakkad', 42022, 10.7828, 76.2775, false),
  ('Q7798291', 'Thrithala', 'Kerala', 'Palakkad', null, 10.8, 76.1167, false),
  ('Q13109864', 'Adoor Municipality', 'Kerala', 'Pathanamthitta', 28943, 9.1638, 76.7398, false),
  ('Q5353628', 'Elavumthitta', 'Kerala', 'Pathanamthitta', null, 9.2667, 76.7, false),
  ('Q3595509', 'Konni', 'Kerala', 'Pathanamthitta', null, 9.241, 76.8784, false),
  ('Q6430507', 'Koodal', 'Kerala', 'Pathanamthitta', null, 9.15, 76.85, false),
  ('Q6443709', 'Kumbanad', 'Kerala', 'Pathanamthitta', null, 9.352, 76.661, false),
  ('Q6744066', 'Mallapally', 'Kerala', 'Pathanamthitta', null, 9.3833, 76.6333, false),
  ('Q7089510', 'Omallur', 'Kerala', 'Pathanamthitta', null, 9.44, 76.54, false),
  ('Q29467707', 'Pandalam Municipality', 'Kerala', 'Pathanamthitta', null, 9.2166, 76.6645, false),
  ('Q1025266', 'Pathanamthitta', 'Kerala', 'Pathanamthitta', 37802, 9.2647, 76.7872, false),
  ('Q13113067', 'Pathanamthitta Municipality', 'Kerala', 'Pathanamthitta', 37802, 9.2713, 76.7959, false),
  ('Q13112503', 'Thiruvalla Municipality', 'Kerala', 'Pathanamthitta', 56828, 9.3797, 76.5757, false),
  ('Q2336443', 'Tiruvalla', 'Kerala', 'Pathanamthitta', null, 9.385, 76.575, false),
  ('Q4752775', 'Anchuthengu', 'Kerala', 'Thiruvananthapuram', null, 8.4833, 76.9167, false),
  ('Q18109902', 'Attakulangara', 'Kerala', 'Thiruvananthapuram', null, 8.4744, 76.9475, false),
  ('Q534444', 'Attingal', 'Kerala', 'Thiruvananthapuram', null, 8.6982, 76.8137, false),
  ('Q13110278', 'Attingal Municipality', 'Kerala', 'Thiruvananthapuram', 35648, 8.68, 76.83, false),
  ('Q18126504', 'Kallattumukku', 'Kerala', 'Thiruvananthapuram', null, 8.4744, 76.9475, false),
  ('Q17479902', 'Kamaleswaram', 'Kerala', 'Thiruvananthapuram', null, 8.4744, 76.9475, false),
  ('Q6746587', 'Manacaud', 'Kerala', 'Thiruvananthapuram', null, 8.4744, 76.9475, false),
  ('Q6750745', 'Mannanthala', 'Kerala', 'Thiruvananthapuram', null, 8.5647, 76.9436, false),
  ('Q16136132', 'Nedumangad Municipality', 'Kerala', 'Thiruvananthapuram', 56138, 8.37, 77.0, false),
  ('Q2569280', 'Neyyattinkara', 'Kerala', 'Thiruvananthapuram', null, 8.4, 77.08, false),
  ('Q16136256', 'Neyyattinkara Municipality', 'Kerala', 'Thiruvananthapuram', 69449, 8.4, 77.08, false),
  ('Q7128553', 'Palode', 'Kerala', 'Thiruvananthapuram', null, 8.7033, 77.0264, false),
  ('Q7136008', 'Parassala', 'Kerala', 'Thiruvananthapuram', null, 8.4405, 77.0437, false),
  ('Q18129343', 'Perunthanni', 'Kerala', 'Thiruvananthapuram', null, 8.495, 76.9292, false),
  ('Q7228533', 'Poojappura', 'Kerala', 'Thiruvananthapuram', null, 8.4834, 76.981, false),
  ('Q40738257', 'Thiruvallam', 'Kerala', 'Thiruvananthapuram', null, 8.4479, 76.9556, false),
  ('Q167715', 'Thiruvananthapuram', 'Kerala', 'Thiruvananthapuram', 743691, 8.4875, 76.9525, false),
  ('Q1012951', 'Varkala', 'Kerala', 'Thiruvananthapuram', 42273, 8.7331, 76.7169, false),
  ('Q16134156', 'Varkala Municipality', 'Kerala', 'Thiruvananthapuram', 42273, 8.7416, 76.7187, false),
  ('Q7917623', 'Vazhuthacaud', 'Kerala', 'Thiruvananthapuram', null, 8.5003, 76.9624, false),
  ('Q7919892', 'Venganoor', 'Kerala', 'Thiruvananthapuram', null, 8.3964, 77.0033, false),
  ('Q7923838', 'Vettuthura', 'Kerala', 'Thiruvananthapuram', null, 8.5833, 76.8167, false),
  ('Q7937079', 'Vithura', 'Kerala', 'Thiruvananthapuram', null, 8.6818, 77.1022, false),
  ('Q25247911', 'Adat', 'Kerala', 'Thrissur', null, 10.52, 76.06, false),
  ('Q861830', 'Chalakudy', 'Kerala', 'Thrissur', null, 10.3, 76.33, false),
  ('Q13111918', 'Chalakudy Municipality', 'Kerala', 'Thrissur', 28873, 10.3084, 76.3276, false),
  ('Q13111926', 'Chavakkad Municipality', 'Kerala', 'Thrissur', 33543, 10.589, 76.0167, false),
  ('Q5092634', 'Cheruthuruthi', 'Kerala', 'Thrissur', null, 10.7426, 76.2717, false),
  ('Q20578190', 'Guruvayur Municipality', 'Kerala', 'Thrissur', 38138, 10.5989, 76.0432, false),
  ('Q16133667', 'Irinjalakuda Municipality', 'Kerala', 'Thrissur', 51585, 10.3514, 76.2178, false),
  ('Q6425154', 'Kodakara', 'Kerala', 'Thrissur', null, 10.3719, 76.3056, false),
  ('Q1006282', 'Kodungallur', 'Kerala', 'Thrissur', 70868, 10.22, 76.22, false),
  ('Q16134960', 'Kodungallur Municipality', 'Kerala', 'Thrissur', 48371, 10.2223, 76.2036, false),
  ('Q607065', 'Koratty', 'Kerala', 'Thrissur', null, 10.15, 76.21, false),
  ('Q13111314', 'Kunnamkulam Municipality', 'Kerala', 'Thrissur', 49230, 10.637, 76.0529, false),
  ('Q720128', 'Nenmanikkara', 'Kerala', 'Thrissur', null, 10.4392, 76.268, false),
  ('Q3091349', 'Palayoor', 'Kerala', 'Thrissur', null, 10.5825, 76.0319, false),
  ('Q13564526', 'Patturaikkal', 'Kerala', 'Thrissur', null, 10.5354, 76.2115, false),
  ('Q15265958', 'Perambra', 'Kerala', 'Thrissur', null, 10.3, 76.33, false),
  ('Q2568270', 'Puthukkad', 'Kerala', 'Thrissur', null, 10.4272, 76.2711, false),
  ('Q163798', 'Thrissur', 'Kerala', 'Thrissur', 315596, 10.52, 76.21, false),
  ('Q23307869', 'Wadakanchery Municipality', 'Kerala', 'Thrissur', null, 10.6505, 76.2294, false),
  ('Q7958935', 'Wadakkancherry', 'Kerala', 'Thrissur', null, 10.6594, 76.2494, false),
  ('Q911025', 'Kalpetta', 'Kerala', 'Wayanad', null, 11.6103, 76.0828, false),
  ('Q13111774', 'Kalpetta Municipality', 'Kerala', 'Wayanad', 29602, 11.6088, 76.0814, false),
  ('Q24949126', 'Kattikkulam', 'Kerala', 'Wayanad', null, 11.8468, 76.0631, false),
  ('Q20582673', 'Mananthavady Municipality', 'Kerala', 'Wayanad', null, 11.8, 76.0, false),
  ('Q136648998', 'Padinjarathara', 'Kerala', 'Wayanad', null, 11.677, 75.975, false),
  ('Q7259587', 'Pulpally', 'Kerala', 'Wayanad', null, 11.788, 76.1593, false),
  ('Q738187', 'Sultan Bathery', 'Kerala', 'Wayanad', null, 11.67, 76.28, false),
  ('Q13115143', 'Sulthan Bathery Municipality', 'Kerala', 'Wayanad', null, 11.67, 76.28, false),
  ('Q7909290', 'Valavayal', 'Kerala', 'Wayanad', null, 11.67, 76.28, false),
  ('Q4682857', 'Adimali', 'Kerala', null, null, 10.0148, 76.9561, false),
  ('Q490941', 'Adoor', 'Kerala', null, null, 9.153, 76.7356, false),
  ('Q28173946', 'Aikkarappadi', 'Kerala', null, null, 11.1864, 75.9064, false),
  ('Q3525198', 'Alakode', 'Kerala', null, null, 12.191, 75.4673, false),
  ('Q24951930', 'Alampady', 'Kerala', null, null, 12.5244, 75.0297, false),
  ('Q585026', 'Alappuzha', 'Kerala', null, null, 9.4981, 76.3388, false),
  ('Q588793', 'Aluva', 'Kerala', null, null, 10.1004, 76.357, false),
  ('Q530464', 'Angamaly', 'Kerala', null, 33424, 10.1926, 76.3869, false),
  ('Q4784004', 'Arambram', 'Kerala', null, null, 11.3333, 75.8833, false),
  ('Q588767', 'Aroor', 'Kerala', null, 39214, 9.8781, 76.3039, false),
  ('Q4881580', 'Bekal', 'Kerala', null, null, 12.4204, 75.0231, false),
  ('Q5086980', 'Charummood', 'Kerala', null, null, 9.1724, 76.6081, false),
  ('Q5089839', 'Chelembra', 'Kerala', null, null, 11.1519, 75.8893, false),
  ('Q24944478', 'Kasaragod North', 'Kerala', null, null, 12.5403, 74.9606, false),
  ('Q6429029', 'Kondotty', 'Kerala', null, null, 11.147, 75.964, false),
  ('Q6754750', 'Maramon', 'Kerala', null, null, 9.3333, 76.6833, false),
  ('Q6755124', 'Marayur', 'Kerala', null, null, 10.2762, 77.1614, false),
  ('Q17056332', 'Morayur', 'Kerala', null, null, 11.1358, 76.0179, false),
  ('Q3525638', 'Nilambur', 'Kerala', null, null, 11.2855, 76.2386, false),
  ('Q7127877', 'Pallikkal', 'Kerala', null, null, 11.075, 75.9958, false),
  ('Q7156995', 'Pazhayannur', 'Kerala', null, null, 10.6661, 76.4252, false),
  ('Q3595909', 'Tanur', 'Kerala', null, null, 10.982, 75.8754, false),
  ('Q18357831', 'Vadookara', 'Kerala', null, null, 10.5, 76.2, false),
  ('Q7909242', 'Valanchery', 'Kerala', null, null, 10.8878, 76.0732, false),
  ('Q24943044', 'Valluvambram Junction', 'Kerala', null, null, 11.1278, 76.0441, false),
  ('Q2283340', 'Vatakara', 'Kerala', null, null, 11.6016, 75.592, false),
  ('Q4167739', 'Dras', 'Ladakh', 'Kargil', null, 34.45, 75.77, false),
  ('Q2088176', 'Kargil', 'Ladakh', 'Kargil', null, 34.5594, 76.1256, false),
  ('Q230818', 'Leh', 'Ladakh', 'Leh', 30870, 34.1642, 77.5847, false),
  ('Q24909819', 'Lingshet', 'Ladakh', 'Leh', 913, 33.9036, 76.8244, false),
  ('Q87206525', 'Spituk', 'Ladakh', 'Leh', null, 34.1152, 77.5548, false),
  ('Q7195866', 'Minicoy', 'Lakshadweep', null, null, 8.2893, 73.0619, false),
  ('Q489236', 'Agar', 'Madhya Pradesh', 'Agar Malwa', null, 23.7, 76.02, false),
  ('Q30590864', 'Dongargaon, Agar Malwa', 'Madhya Pradesh', 'Agar Malwa', null, 24.2475, 76.1682, false),
  ('Q2008051', 'Jaithari', 'Madhya Pradesh', 'Anuppur', null, 23.0432, 81.8038, false),
  ('Q589108', 'Ashoknagar', 'Madhya Pradesh', 'Ashoknagar', null, 24.34, 77.43, false),
  ('Q860192', 'Chanderi', 'Madhya Pradesh', 'Ashoknagar', null, 24.72, 78.13, false),
  ('Q809660', 'Barwani', 'Madhya Pradesh', 'Barwani', null, 22.03, 74.9, false),
  ('Q1707618', 'Gohad', 'Madhya Pradesh', 'Bhind', null, 26.43, 78.44, false),
  ('Q80989', 'Bhopal', 'Madhya Pradesh', 'Bhopal', 1798218, 23.2589, 77.4125, false),
  ('Q2446357', 'Nepanagar', 'Madhya Pradesh', 'Burhanpur', null, 21.4539, 76.3933, false),
  ('Q23043347', 'Alipura', 'Madhya Pradesh', 'Chhatarpur', null, 25.1753, 79.3356, false),
  ('Q1071519', 'Chhatarpur', 'Madhya Pradesh', 'Chhatarpur', null, 24.9177, 79.5887, false),
  ('Q1656981', 'Garhi-Malhara', 'Madhya Pradesh', 'Chhatarpur', null, 25.0447, 79.6772, false),
  ('Q178948', 'Khajuraho', 'Madhya Pradesh', 'Chhatarpur', 24481, 24.8528, 79.9255, false),
  ('Q15235969', 'Khajuraho Hanuman inscription', 'Madhya Pradesh', 'Chhatarpur', null, 24.85, 79.93, false),
  ('Q104804912', 'Khajwa', 'Madhya Pradesh', 'Chhatarpur', null, 24.9174, 79.9269, false),
  ('Q55759111', 'Hanotiya', 'Madhya Pradesh', 'Chhindwara', null, 22.1476, 78.583, false),
  ('Q65057733', 'Junnardeo', 'Madhya Pradesh', 'Chhindwara', null, 22.193, 78.592, false),
  ('Q1192238', 'Datia', 'Madhya Pradesh', 'Datia', null, 25.6731, 78.4592, false),
  ('Q617987', 'Dhar', 'Madhya Pradesh', 'Dhar', null, 22.5992, 75.3028, false),
  ('Q135779422', 'Gandhwani', 'Madhya Pradesh', 'Dhar', null, 22.33, 75.02, false),
  ('Q2552214', 'Mandav', 'Madhya Pradesh', 'Dhar', null, 22.3364, 75.4156, false),
  ('Q147886', 'Mandu', 'Madhya Pradesh', 'Dhar', null, 22.3353, 75.4158, false),
  ('Q3813162', 'Rajgarh', 'Madhya Pradesh', 'Dhar', null, 22.6782, 74.9448, false),
  ('Q2038816', 'Guna', 'Madhya Pradesh', 'Guna', null, 24.65, 77.3167, false),
  ('Q583739', 'Raghogarh-Vijaypur', 'Madhya Pradesh', 'Guna', null, 24.4431, 77.1978, false),
  ('Q158467', 'Gwalior', 'Madhya Pradesh', 'Gwalior', 1069276, 26.2125, 78.1775, false),
  ('Q757845', 'Betma', 'Madhya Pradesh', 'Indore', 12529, 22.68, 75.62, false),
  ('Q48725454', 'Bicholi Hapsi', 'Madhya Pradesh', 'Indore', null, 22.7167, 75.9333, false),
  ('Q2283203', 'Dr. Ambedkar Nagar', 'Madhya Pradesh', 'Indore', null, 22.55, 75.76, false),
  ('Q66616', 'Indore', 'Madhya Pradesh', 'Indore', 1994397, 22.7186, 75.855, false),
  ('Q24951803', 'Adhartal', 'Madhya Pradesh', 'Jabalpur', null, 23.2, 79.95, false),
  ('Q158455', 'Bhedaghat', 'Madhya Pradesh', 'Jabalpur', null, 23.13, 79.8, false),
  ('Q200878', 'Jabalpur', 'Madhya Pradesh', 'Jabalpur', 1267564, 23.1667, 79.9333, false),
  ('Q2720761', 'Petlawad', 'Madhya Pradesh', 'Jhabua', null, 23.0, 74.8, false),
  ('Q172581', 'Katni', 'Madhya Pradesh', 'Katni', 221883, 23.837, 80.3943, false),
  ('Q39060695', 'Niwar', 'Madhya Pradesh', 'Katni', null, 24.0, 80.4, false),
  ('Q24929370', 'Rithi, Katni', 'Madhya Pradesh', 'Katni', null, 23.9, 80.133, false),
  ('Q48733876', 'Chhanera', 'Madhya Pradesh', 'Khandwa', null, 21.623, 76.372, false),
  ('Q1648551', 'Khandwa', 'Madhya Pradesh', 'Khandwa', null, 21.83, 76.33, false),
  ('Q16891715', 'Gogawan', 'Madhya Pradesh', 'Khargone', null, 21.91, 75.7, false),
  ('Q1949134', 'Khargone', 'Madhya Pradesh', 'Khargone', null, 21.49, 75.36, false),
  ('Q1023674', 'Maheshwar, Madhya Pradesh', 'Madhya Pradesh', 'Khargone', null, 22.1769, 75.5856, false),
  ('Q2465668', 'Sanawad', 'Madhya Pradesh', 'Khargone', null, 22.18, 76.07, false),
  ('Q1784846', 'Morena', 'Madhya Pradesh', 'Morena', null, 26.5, 78.0, false),
  ('Q928162', 'Itarsi', 'Madhya Pradesh', 'Narmadapuram', null, 22.62, 77.75, false),
  ('Q765367', 'Makhan Nagar', 'Madhya Pradesh', 'Narmadapuram', null, 22.7, 77.93, false),
  ('Q620804', 'Narmadapuram', 'Madhya Pradesh', 'Narmadapuram', 117988, 22.75, 77.72, false),
  ('Q24887654', 'Semri Harchand', 'Madhya Pradesh', 'Narmadapuram', null, 22.6833, 78.0833, false),
  ('Q24945751', 'Tawa Nagar', 'Madhya Pradesh', 'Narmadapuram', null, 22.57, 77.96, false),
  ('Q941901', 'Neemuch', 'Madhya Pradesh', 'Neemuch', null, 24.45, 74.87, false),
  ('Q201631', 'Orchha', 'Madhya Pradesh', 'Niwari', 11511, 25.35, 78.64, false),
  ('Q583090', 'Ajaigarh', 'Madhya Pradesh', 'Panna', 16656, 24.9015, 80.2584, false),
  ('Q593695', 'Panna', 'Madhya Pradesh', 'Panna', null, 24.72, 80.2, false),
  ('Q3373052', 'Bhojpur, Madhya Pradesh', 'Madhya Pradesh', 'Raisen', null, 23.115, 77.5953, false),
  ('Q584544', 'Narsinghgarh', 'Madhya Pradesh', 'Rajgarh', null, 23.7092, 77.0911, false),
  ('Q1287117', 'Jaora', 'Madhya Pradesh', 'Ratlam', null, 23.63, 75.13, false),
  ('Q652376', 'Ratlam', 'Madhya Pradesh', 'Ratlam', 273892, 23.3167, 75.0667, false),
  ('Q861906', 'Chakghat', 'Madhya Pradesh', 'Rewa', null, 25.0247, 81.7375, false),
  ('Q2228620', 'Govindgarh', 'Madhya Pradesh', 'Rewa', null, 24.38, 81.3, false),
  ('Q1000495', 'Rewa', 'Madhya Pradesh', 'Rewa', null, 24.5167, 81.2833, false),
  ('Q858501', 'Bina-Etawa', 'Madhya Pradesh', 'Sagar', null, 24.18, 78.2, false),
  ('Q1006355', 'Sagar', 'Madhya Pradesh', 'Sagar', null, 23.83, 78.71, false),
  ('Q1192410', 'Chitrakoot, Madhya Pradesh', 'Madhya Pradesh', 'Satna', null, 25.18, 80.87, false),
  ('Q747140', 'Maihar', 'Madhya Pradesh', 'Satna', 40192, 24.27, 80.75, false),
  ('Q6737764', 'Majhgawan', 'Madhya Pradesh', 'Satna', null, 24.8, 80.8, false),
  ('Q58794', 'Satna', 'Madhya Pradesh', 'Satna', 283004, 24.5984, 80.8281, false),
  ('Q28319968', 'Bandol seoni', 'Madhya Pradesh', 'Seoni', null, 22.23, 79.54, false),
  ('Q583660', 'Amlai', 'Madhya Pradesh', 'Shahdol', null, 22.1892, 78.6903, false),
  ('Q2484025', 'Shahdol', 'Madhya Pradesh', 'Shahdol', 86681, 23.28, 81.35, false),
  ('Q584980', 'Badagoan', 'Madhya Pradesh', 'Shajapur', null, 23.7331, 76.3069, false),
  ('Q2720813', 'Shujalpur', 'Madhya Pradesh', 'Shajapur', null, 23.4, 76.72, false),
  ('Q2036966', 'Shivpuri', 'Madhya Pradesh', 'Shivpuri', null, 25.4333, 77.65, false),
  ('Q2311223', 'Mahidpur', 'Madhya Pradesh', 'Ujjain', null, 23.4872, 75.6572, false),
  ('Q200119', 'Ujjain', 'Madhya Pradesh', 'Ujjain', 515215, 23.1828, 75.7772, false),
  ('Q2483919', 'Umaria', 'Madhya Pradesh', 'Umaria', 33114, 23.5245, 80.8365, false),
  ('Q714617', 'Ganj Basoda', 'Madhya Pradesh', 'Vidisha', null, 23.85, 77.93, false),
  ('Q1557963', 'Gyaraspur', 'Madhya Pradesh', 'Vidisha', null, 23.6655, 78.1117, false),
  ('Q25247667', 'Pathari', 'Madhya Pradesh', 'Vidisha', null, 23.9333, 78.2167, false),
  ('Q1637471', 'Vidisha', 'Madhya Pradesh', 'Vidisha', 155959, 23.5239, 77.8061, false),
  ('Q593193', 'Burhanpur', 'Madhya Pradesh', null, null, 21.3, 76.2267, false),
  ('Q108760378', 'Chicholi', 'Madhya Pradesh', null, null, 22.01, 77.66, false),
  ('Q1266413', 'Dewas', 'Madhya Pradesh', null, null, 22.9667, 76.0667, false),
  ('Q636529', 'Mandi Bamora', 'Madhya Pradesh', null, null, 24.0553, 78.0892, false),
  ('Q1922275', 'Mandsaur', 'Madhya Pradesh', null, 141667, 24.03, 75.08, false),
  ('Q1093334', 'Omkareshwar Temple', 'Madhya Pradesh', null, null, 22.2456, 76.1511, false),
  ('Q134656713', 'Raghogarh', 'Madhya Pradesh', null, 398, 24.4425, 77.1973, false),
  ('Q255780', 'Singrauli', 'Madhya Pradesh', null, null, 24.11, 82.39, false),
  ('Q25247863', 'Udaypur', 'Madhya Pradesh', null, null, 23.9002, 78.0567, false),
  ('Q223517', 'Ahilyanagar', 'Maharashtra', 'Ahilyanagar', 350859, 19.0833, 74.7333, false),
  ('Q55625258', 'Nimbhere', 'Maharashtra', 'Ahilyanagar', null, 19.47, 74.45, false),
  ('Q213014', 'Akola', 'Maharashtra', 'Akola', 425817, 20.7333, 77.0, false),
  ('Q269899', 'Amravati', 'Maharashtra', 'Amravati', 549370, 20.9333, 77.75, false),
  ('Q583982', 'Anjangaon', 'Maharashtra', 'Amravati', null, 21.1652, 77.3091, false),
  ('Q200713', 'Aurangabad', 'Maharashtra', 'Aurangabad', 1175116, 19.88, 75.32, false),
  ('Q1025625', 'Khuldabad', 'Maharashtra', 'Aurangabad', null, 20.0095, 75.1888, false),
  ('Q584032', 'Ambajogai', 'Maharashtra', 'Beed', null, 18.73, 76.38, false),
  ('Q814033', 'Beed', 'Maharashtra', 'Beed', 146709, 18.9904, 75.7542, false),
  ('Q24930608', 'Dadegaon', 'Maharashtra', 'Beed', null, 18.967, 75.08, false),
  ('Q2546703', 'Majalgaon', 'Maharashtra', 'Beed', null, 19.1551, 76.2099, false),
  ('Q3785959', 'Parli', 'Maharashtra', 'Beed', null, 18.85, 76.5333, false),
  ('Q546955', 'Nandura', 'Maharashtra', 'Buldhana', null, 20.8333, 76.4597, false),
  ('Q2546796', 'Bramhapuri', 'Maharashtra', 'Chandrapur', null, 20.36, 79.51, false),
  ('Q861194', 'Chandrapur', 'Maharashtra', 'Chandrapur', null, 19.95, 79.3, false),
  ('Q24906393', 'Nanda Fata', 'Maharashtra', 'Chandrapur', null, 19.7739, 79.1365, false),
  ('Q2462135', 'Dharashiv', 'Maharashtra', 'Dharashiv', 112085, 18.1667, 76.05, false),
  ('Q2546781', 'Murum', 'Maharashtra', 'Dharashiv', null, 17.7881, 76.4708, false),
  ('Q30621488', 'Turori', 'Maharashtra', 'Dharashiv', null, 17.8278, 76.6903, false),
  ('Q773603', 'Dhule', 'Maharashtra', 'Dhule', 375559, 20.9, 74.7833, false),
  ('Q1707857', 'Gondia', 'Maharashtra', 'Gondia', 132821, 21.45, 80.2, false),
  ('Q1192614', 'Chopda', 'Maharashtra', 'Jalgaon', null, 21.25, 75.3, false),
  ('Q1523144', 'Faizpur', 'Maharashtra', 'Jalgaon', null, 21.17, 75.85, false),
  ('Q30951', 'Jalgaon', 'Maharashtra', 'Jalgaon', 460468, 21.0167, 75.5667, false),
  ('Q108559163', 'Nagardeole', 'Maharashtra', 'Jalgaon', null, 20.5667, 75.2167, false),
  ('Q3238579', 'Savda', 'Maharashtra', 'Jalgaon', null, 21.15, 75.88, false),
  ('Q30771', 'Jalna', 'Maharashtra', 'Jalna', 285577, 19.8333, 75.8833, false),
  ('Q5516804', 'Gaganbawada', 'Maharashtra', 'Kolhapur', null, 16.5458, 73.8311, false),
  ('Q3758071', 'Gandhinagar', 'Maharashtra', 'Kolhapur', null, 16.7091, 74.2821, false),
  ('Q583818', 'Ichalkaranji', 'Maharashtra', 'Kolhapur', 287570, 16.7, 74.47, false),
  ('Q2442675', 'Kagal', 'Maharashtra', 'Kolhapur', null, 16.58, 74.32, false),
  ('Q108933936', 'Kodoli', 'Maharashtra', 'Kolhapur', null, 16.88, 74.2, false),
  ('Q209698', 'Kolhapur', 'Maharashtra', 'Kolhapur', null, 16.7, 74.2333, false),
  ('Q2719424', 'Panhala', 'Maharashtra', 'Kolhapur', null, 16.82, 74.12, false),
  ('Q61394', 'Latur', 'Maharashtra', 'Latur', 266955, 18.3972, 76.5678, false),
  ('Q1156', 'Mumbai', 'Maharashtra', 'Mumbai City', 15414288, 19.0758, 72.8775, true),
  ('Q5383080', 'Vikhroli', 'Maharashtra', 'Mumbai Suburban', null, 19.11, 72.94, false),
  ('Q24946826', 'Jalalkheda', 'Maharashtra', 'Nagpur', null, 21.4392, 78.7719, false),
  ('Q2135471', 'Khapa', 'Maharashtra', 'Nagpur', null, 20.92, 78.95, false),
  ('Q1320187', 'Mansar', 'Maharashtra', 'Nagpur', null, 21.4, 79.25, false),
  ('Q1513', 'Nagpur', 'Maharashtra', 'Nagpur', 2405665, 21.1497, 79.0806, false),
  ('Q2545077', 'Ramtek, Maharashtra', 'Maharashtra', 'Nagpur', null, 21.395, 79.327, false),
  ('Q2551212', 'Sonegaon', 'Maharashtra', 'Nagpur', null, 20.8048, 78.9577, false),
  ('Q2241450', 'Kundalwadi', 'Maharashtra', 'Nanded', null, 18.8072, 77.7703, false),
  ('Q3823613', 'Mahur', 'Maharashtra', 'Nanded', null, 19.8478, 77.9239, false),
  ('Q855122', 'Nanded', 'Maharashtra', 'Nanded', null, 19.15, 77.3333, false),
  ('Q886590', 'Nanded-Waghala', 'Maharashtra', 'Nanded', null, 19.1497, 77.3331, false),
  ('Q2087583', 'Nandurbar', 'Maharashtra', 'Nandurbar', null, 21.3667, 74.25, false),
  ('Q1383573', 'Shahada', 'Maharashtra', 'Nandurbar', null, 21.5452, 74.4721, false),
  ('Q580965', 'Malegaon', 'Maharashtra', 'Nashik', 576642, 20.5497, 74.5347, false),
  ('Q200235', 'Nashik', 'Maharashtra', 'Nashik', 1486053, 20.0, 73.7833, false),
  ('Q24906832', 'Pimapalas', 'Maharashtra', 'Nashik', null, 20.0833, 73.8, false),
  ('Q2724534', 'Sinnar', 'Maharashtra', 'Nashik', null, 19.85, 74.0, false),
  ('Q2719283', 'Trimbak', 'Maharashtra', 'Nashik', null, 19.9328, 73.5292, false),
  ('Q1190226', 'Dahanu', 'Maharashtra', 'Palghar', null, 19.97, 72.73, false),
  ('Q48724980', 'Dandi Census Town', 'Maharashtra', 'Palghar', null, 19.7939, 72.6939, false),
  ('Q48724981', 'Khaira', 'Maharashtra', 'Palghar', null, 19.7858, 72.7522, false),
  ('Q6895283', 'Mokhada', 'Maharashtra', 'Palghar', null, 19.9333, 73.3333, false),
  ('Q12435629', 'Nala Sopara', 'Maharashtra', 'Palghar', null, 19.4154, 72.8613, false),
  ('Q48724962', 'Salwad Census Town', 'Maharashtra', 'Palghar', null, 19.803, 72.724, false),
  ('Q48724969', 'Shirgaon Census Town', 'Maharashtra', 'Palghar', null, 19.697, 72.715, false),
  ('Q4007184', 'Vada', 'Maharashtra', 'Palghar', null, 19.6535, 73.1481, false),
  ('Q1949022', 'Vasai', 'Maharashtra', 'Palghar', null, 19.47, 72.8, false),
  ('Q580876', 'Vasai-Virar', 'Maharashtra', 'Palghar', 1222390, 19.47, 72.8, false),
  ('Q2487341', 'Virar', 'Maharashtra', 'Palghar', null, 19.4559, 72.8114, false),
  ('Q2718737', 'Selu', 'Maharashtra', 'Parbhani', null, 19.4551, 76.4372, false),
  ('Q712015', 'Baramati', 'Maharashtra', 'Pune', null, 18.15, 74.58, false),
  ('Q4945101', 'Bori', 'Maharashtra', 'Pune', null, 20.3483, 77.8565, false),
  ('Q1192430', 'Dehu', 'Maharashtra', 'Pune', null, 18.72, 73.77, false),
  ('Q1755879', 'Jejuri', 'Maharashtra', 'Pune', null, 18.2723, 74.1604, false),
  ('Q2445461', 'Junnar', 'Maharashtra', 'Pune', 40000, 19.2, 73.88, false),
  ('Q6741450', 'Malavli', 'Maharashtra', 'Pune', null, 18.7447, 73.4817, false),
  ('Q6373883', 'Pashan', 'Maharashtra', 'Pune', null, 18.5353, 73.7828, false),
  ('Q119219', 'Pimpri-Chinchwad', 'Maharashtra', 'Pune', 1729320, 18.6278, 73.8131, false),
  ('Q55630059', 'Pirangut', 'Maharashtra', 'Pune', null, 18.5115, 73.6801, false),
  ('Q1538', 'Pune', 'Maharashtra', 'Pune', 6200000, 18.5211, 73.8553, true),
  ('Q2719101', 'Rajgurunagar', 'Maharashtra', 'Pune', null, 18.8667, 73.9, false),
  ('Q2544796', 'Saswad', 'Maharashtra', 'Pune', null, 18.55, 74.0, false),
  ('Q3773513', 'Goregaon', 'Maharashtra', 'Raigad', null, 18.1548, 73.2915, false),
  ('Q5457414', 'Kalamboli', 'Maharashtra', 'Raigad', null, 19.0333, 73.1, false),
  ('Q2283155', 'Karjat', 'Maharashtra', 'Raigad', null, 18.9234, 73.3251, false),
  ('Q12422734', 'Khopoli', 'Maharashtra', 'Raigad', null, 18.7914, 73.3442, false),
  ('Q6748809', 'Mangaon', 'Maharashtra', 'Raigad', null, 18.2333, 73.2833, false),
  ('Q297511', 'Panvel', 'Maharashtra', 'Raigad', null, 18.98, 73.1, false),
  ('Q15272986', 'Roha', 'Maharashtra', 'Raigad', null, 18.4543, 73.1147, false),
  ('Q2566453', 'Shrivardhan', 'Maharashtra', 'Raigad', null, 18.0333, 73.0167, false),
  ('Q1113891', 'Uran', 'Maharashtra', 'Raigad', 30439, 18.89, 72.95, false),
  ('Q1117869', 'Chiplun', 'Maharashtra', 'Ratnagiri', null, 17.53, 73.52, false),
  ('Q5221789', 'Dapoli', 'Maharashtra', 'Ratnagiri', null, 17.7589, 73.1856, false),
  ('Q1708334', 'Guhagar', 'Maharashtra', 'Ratnagiri', null, 17.47, 73.2, false),
  ('Q2245536', 'Khed', 'Maharashtra', 'Ratnagiri', 16892, 17.72, 73.38, false),
  ('Q963674', 'Rajapur', 'Maharashtra', 'Ratnagiri', null, 16.67, 73.52, false),
  ('Q1922257', 'Ratnagiri', 'Maharashtra', 'Ratnagiri', null, 16.9833, 73.3, false),
  ('Q6415917', 'Kirloskarwadi', 'Maharashtra', 'Sangli', null, 17.085, 74.414, false),
  ('Q25247500', 'Kundal', 'Maharashtra', 'Sangli', null, 17.117, 74.414, false),
  ('Q429215', 'Sangli', 'Maharashtra', 'Sangli', 436639, 16.8667, 74.5667, false),
  ('Q24946388', 'Upalavi', 'Maharashtra', 'Sangli', null, 16.9828, 74.6757, false),
  ('Q7973205', 'Wategaon', 'Maharashtra', 'Sangli', null, 17.1022, 74.1611, false),
  ('Q2445542', 'Karad', 'Maharashtra', 'Satara', null, 17.28, 74.2, false),
  ('Q24932356', 'Malkapur, Karad', 'Maharashtra', 'Satara', null, 17.28, 74.2, false),
  ('Q581562', 'Satara', 'Maharashtra', 'Satara', 120079, 17.6833, 73.9833, false),
  ('Q2450888', 'Malvan', 'Maharashtra', 'Sindhudurg', null, 16.0565, 73.4688, false),
  ('Q2544948', 'Sangole', 'Maharashtra', 'Solapur', null, 17.4394, 75.1939, false),
  ('Q237847', 'Solapur', 'Maharashtra', 'Solapur', 951558, 17.6703, 75.9011, false),
  ('Q584008', 'Ambernath', 'Maharashtra', 'Thane', null, 19.209, 73.186, false),
  ('Q645725', 'Bhiwandi', 'Maharashtra', 'Thane', 709665, 19.3, 73.0667, false),
  ('Q3034709', 'Dombivli', 'Maharashtra', 'Thane', null, 19.2184, 73.0867, false),
  ('Q2317504', 'Jawhar', 'Maharashtra', 'Thane', null, 19.92, 73.23, false),
  ('Q366754', 'Kalyan', 'Maharashtra', 'Thane', null, 19.25, 73.15, false),
  ('Q1006343', 'Mira-Bhayandar', 'Maharashtra', 'Thane', 814655, 19.3, 72.85, false),
  ('Q6935373', 'Mumbra', 'Maharashtra', 'Thane', null, 19.18, 73.0225, false),
  ('Q61445', 'Navi Mumbai', 'Maharashtra', 'Thane', 1119477, 19.03, 73.01, false),
  ('Q207749', 'Thane', 'Maharashtra', 'Thane', 1886941, 19.18, 72.9633, false),
  ('Q7810359', 'Titwala', 'Maharashtra', 'Thane', null, 19.299, 73.223, false),
  ('Q7853750', 'Turbhe', 'Maharashtra', 'Thane', null, 19.4, 73.1, false),
  ('Q460222', 'Ulhasnagar', 'Maharashtra', 'Thane', 506098, 19.2167, 73.15, false),
  ('Q7916821', 'Vasind', 'Maharashtra', 'Thane', null, 19.4167, 73.2667, false),
  ('Q2719107', 'Pulgaon', 'Maharashtra', 'Wardha', null, 20.726, 78.317, false),
  ('Q1772819', 'Wardha', 'Maharashtra', 'Wardha', null, 20.75, 78.6167, false),
  ('Q2317517', 'Karanja Lad', 'Maharashtra', 'Washim', null, 20.4833, 77.4833, false),
  ('Q2299018', 'Washim', 'Maharashtra', 'Washim', 62863, 20.1, 77.15, false),
  ('Q1748341', 'Wani', 'Maharashtra', 'Yavatmal', null, 20.07, 78.95, false),
  ('Q280709', 'Yavatmal', 'Maharashtra', 'Yavatmal', 116551, 20.4, 78.1333, false),
  ('Q24907739', 'Hajipurwadi', 'Maharashtra', null, null, 20.0576, 74.8981, false),
  ('Q24906332', 'Palam, Parbhani', 'Maharashtra', null, null, 19.0117, 76.9067, false),
  ('Q4880782', 'Behiang', 'Manipur', 'Churachandpur', null, 24.0071, 93.5577, false),
  ('Q7127818', 'Pallel', 'Manipur', 'Kakching', null, 24.45, 94.0333, false),
  ('Q3523096', 'Moreh', 'Manipur', 'Tengnoupal', 16847, 24.2478, 94.3037, false),
  ('Q2234602', 'Lilong', 'Manipur', 'Thoubal', null, 24.7164, 93.9408, false),
  ('Q15208842', 'Chakpikarong', 'Manipur', null, null, 24.3167, 93.9833, false),
  ('Q208097', 'Imphal', 'Manipur', null, 268243, 24.82, 93.95, false),
  ('Q211030', 'Cherrapunji', 'Meghalaya', 'East Khasi Hills', 14816, 25.2792, 91.7242, false),
  ('Q48724998', 'Lawsohtun', 'Meghalaya', 'East Khasi Hills', null, 25.5622, 91.8583, false),
  ('Q207752', 'Shillong', 'Meghalaya', 'East Khasi Hills', 143229, 25.5744, 91.8789, false),
  ('Q108145158', 'Umlyngka', 'Meghalaya', 'East Khasi Hills', null, 25.5725, 91.8406, false),
  ('Q5242368', 'Dawki', 'Meghalaya', 'Jaintia Hills', null, 25.1833, 92.0167, false),
  ('Q51287904', 'Nongtalang', 'Meghalaya', 'Jaintia Hills', null, 25.2093, 92.0668, false),
  ('Q108147538', 'Umroi', 'Meghalaya', 'Ri-Bhoi', null, 25.7472, 91.8717, false),
  ('Q2317186', 'Tura', 'Meghalaya', 'West Garo Hills', null, 25.52, 90.22, false),
  ('Q192379', 'Aizawl', 'Mizoram', 'Aizawl', 293416, 23.7333, 92.7167, false),
  ('Q24929741', 'Zokhawthar', 'Mizoram', 'Champhai', null, 23.3652, 93.3855, false),
  ('Q18125712', 'Hortoki', 'Mizoram', 'Kolasib', null, 24.0639, 92.5972, false),
  ('Q22906759', 'Bilkhawthlir', 'Mizoram', null, null, 24.3478, 92.7594, false),
  ('Q1193830', 'Chümoukedima', 'Nagaland', 'Chümoukedima', 43516, 25.7916, 93.7818, false),
  ('Q867111', 'Dimapur', 'Nagaland', 'Dimapur', null, 25.9125, 93.7417, false),
  ('Q234056', 'Kohima', 'Nagaland', 'Kohima', 99039, 25.6667, 94.1194, false),
  ('Q24908961', 'Ahthibung', 'Nagaland', 'Peren', null, 25.4939, 93.6092, false),
  ('Q24909581', 'Jalukie', 'Nagaland', null, null, 25.5708, 93.7285, false),
  ('Q2352219', 'Talcher', 'Odisha', 'Angul', null, 20.95, 85.23, false),
  ('Q641098', 'Balasore', 'Odisha', 'Balasore', 118162, 21.4928, 86.9336, false),
  ('Q28174250', 'Rupsa', 'Odisha', 'Balasore', null, 21.6167, 87.0167, false),
  ('Q3965109', 'Soro', 'Odisha', 'Balasore', null, 21.2785, 86.6883, false),
  ('Q712508', 'Barapali', 'Odisha', 'Bargarh', null, 21.2, 83.5833, false),
  ('Q303761', 'Boudh', 'Odisha', 'Boudh', null, 20.8333, 84.3167, false),
  ('Q207324', 'Cuttack', 'Odisha', 'Cuttack', 606007, 20.45, 85.8667, false),
  ('Q1931717', 'Dhenkanal', 'Odisha', 'Dhenkanal', 67414, 20.6667, 85.6, false),
  ('Q1105855', 'Chikiti', 'Odisha', 'Ganjam', null, 19.2023, 84.6145, false),
  ('Q55614824', 'Jagannath Prasad, Ganjam', 'Odisha', 'Ganjam', null, 19.97, 84.77, false),
  ('Q20203325', 'Mujagada, Ganjam', 'Odisha', 'Ganjam', null, 19.06, 84.58, false),
  ('Q759348', 'Bhawanipatna', 'Odisha', 'Kalahandi', 69045, 19.9, 83.1667, false),
  ('Q48734697', 'Aul', 'Odisha', 'Kendrapara', null, 20.67, 86.64, false),
  ('Q2082443', 'Kendrapara', 'Odisha', 'Kendrapara', null, 20.5, 86.4167, false),
  ('Q1190218', 'Daitari', 'Odisha', 'Kendujhar', null, 21.112, 85.823, false),
  ('Q171771', 'Bhubaneswar', 'Odisha', 'Khordha', 837737, 20.295, 85.825, false),
  ('Q2352196', 'Jatani', 'Odisha', 'Khordha', 63697, 20.17, 85.7, false),
  ('Q6389101', 'Kenduli Sasan', 'Odisha', 'Khordha', null, 20.13, 85.6, false),
  ('Q2241122', 'Khordha', 'Odisha', 'Khordha', null, 20.1833, 85.6167, false),
  ('Q7449434', 'Semiliguda', 'Odisha', 'Koraput', null, 18.7, 82.85, false),
  ('Q712356', 'Baripada', 'Odisha', 'Mayurbhanj', null, 21.935, 86.7214, false),
  ('Q749189', 'Konark', 'Odisha', 'Puri', 15015, 19.8878, 86.0948, false),
  ('Q207799', 'Puri', 'Odisha', 'Puri', 201026, 19.8, 85.8167, false),
  ('Q1707762', 'Gunupur', 'Odisha', 'Rayagada', null, 19.08, 83.82, false),
  ('Q876483', 'Sambalpur', 'Odisha', 'Sambalpur', null, 21.45, 83.9667, false),
  ('Q15203016', 'Bonaigarh', 'Odisha', 'Sundargarh', null, 21.75, 84.97, false),
  ('Q1012706', 'Rourkela', 'Odisha', 'Sundargarh', 552970, 22.2492, 84.8828, false),
  ('Q132295', 'Tarbha', 'Odisha', null, null, 20.43, 83.4, false),
  ('Q277258', 'Karaikal', 'Puducherry', 'Karaikal', null, 10.9328, 79.8319, false),
  ('Q590361', 'Auroville', 'Puducherry', 'Viluppuram', 3288, 12.0018, 79.8009, false),
  ('Q639421', 'Pondicherry', 'Puducherry', null, null, 11.93, 79.83, false),
  ('Q277322', 'Yanam', 'Puducherry', null, null, 16.7333, 82.2167, false),
  ('Q585651', 'Ajnala', 'Punjab', 'Amritsar', null, 31.84, 74.76, false),
  ('Q48403', 'Amritsar', 'Punjab', 'Amritsar', 1159227, 31.6269, 74.877, false),
  ('Q3440891', 'Attari', 'Punjab', 'Amritsar', null, 31.6008, 74.6056, false),
  ('Q5577727', 'Goindwal Sahib', 'Punjab', 'Amritsar', 7772, 31.3667, 75.15, false),
  ('Q136822894', 'Katra Ahluwalia', 'Punjab', 'Amritsar', null, 31.6202, 74.877, false),
  ('Q30592408', 'Verka Town', 'Punjab', 'Amritsar', null, 31.665, 74.932, false),
  ('Q711996', 'Barnala', 'Punjab', 'Barnala', null, 30.37, 75.54, false),
  ('Q709319', 'Bathinda', 'Punjab', 'Bathinda', 285813, 30.2133, 74.9519, false),
  ('Q2545513', 'Rampura Phul', 'Punjab', 'Bathinda', null, 30.2561, 75.2411, false),
  ('Q6138366', 'Talwandi Sabo', 'Punjab', 'Bathinda', null, 29.9836, 75.0828, false),
  ('Q1780350', 'Faridkot', 'Punjab', 'Faridkot', 87695, 30.67, 74.76, false),
  ('Q2672955', 'Sirhind-Fategarh', 'Punjab', 'Fatehgarh Sahib', null, 30.6251, 76.386, false),
  ('Q490878', 'Abohar', 'Punjab', 'Fazilka', null, 30.1334, 74.2001, false),
  ('Q1525269', 'Fazilka', 'Punjab', 'Fazilka', null, 30.403, 74.025, false),
  ('Q2016781', 'Jalalabad', 'Punjab', 'Fazilka', null, 30.62, 74.25, false),
  ('Q652098', 'Firozpur', 'Punjab', 'Firozpur', null, 30.9166, 74.6, false),
  ('Q5949619', 'Hussainiwala', 'Punjab', 'Firozpur', null, 30.9977, 74.5471, false),
  ('Q2545086', 'Talwandi Bhai', 'Punjab', 'Firozpur', null, 30.85, 74.9333, false),
  ('Q709254', 'Batala', 'Punjab', 'Gurdaspur', 183314, 31.8186, 75.2028, false),
  ('Q1707629', 'Gurdaspur', 'Punjab', 'Gurdaspur', null, 32.0333, 75.4, false),
  ('Q1026436', 'Qadian', 'Punjab', 'Gurdaspur', 21899, 31.8192, 75.3764, false),
  ('Q24952482', 'Shankerpura', 'Punjab', 'Gurdaspur', null, 31.8116, 75.1374, false),
  ('Q2719076', 'Sri Hargobindpur', 'Punjab', 'Gurdaspur', null, 31.6894, 75.4797, false),
  ('Q928349', 'Hoshiarpur', 'Punjab', 'Hoshiarpur', null, 31.5322, 75.9172, false),
  ('Q21484418', 'Apra', 'Punjab', 'Jalandhar', 6258, 31.0861, 75.8756, false),
  ('Q1706477', 'Goraya', 'Punjab', 'Jalandhar', null, 31.13, 75.77, false),
  ('Q33377', 'Jalandhar', 'Punjab', 'Jalandhar', 873725, 31.3256, 75.5792, false),
  ('Q3813164', 'Kartarpur', 'Punjab', 'Jalandhar', null, 31.44, 75.5, false),
  ('Q2546657', 'Nakodar', 'Punjab', 'Jalandhar', null, 31.13, 75.47, false),
  ('Q10938567', 'Nurmahal', 'Punjab', 'Jalandhar', null, 31.0964, 75.5967, false),
  ('Q781354', 'Kapurthala', 'Punjab', 'Kapurthala', 101854, 31.38, 75.38, false),
  ('Q338696', 'Phagwara', 'Punjab', 'Kapurthala', 97864, 31.22, 75.77, false),
  ('Q2545249', 'Sultanpur Lodhi', 'Punjab', 'Kapurthala', 16855, 31.212, 75.2026, false),
  ('Q1193432', 'Doraha', 'Punjab', 'Ludhiana', null, 30.8167, 76.0167, false),
  ('Q1101873', 'Khanna', 'Punjab', 'Ludhiana', null, 30.7, 76.22, false),
  ('Q200123', 'Ludhiana', 'Punjab', 'Ludhiana', 1618879, 30.9083, 75.8486, false),
  ('Q932989', 'Sahnewal', 'Punjab', 'Ludhiana', null, 30.8448, 75.9758, false),
  ('Q1470987', 'Malerkotla', 'Punjab', 'Malerkotla', null, 30.5167, 75.8833, false),
  ('Q21857966', 'Borawal', 'Punjab', 'Mansa', null, 29.9959, 75.5431, false),
  ('Q2573916', 'Mansa', 'Punjab', 'Mansa', 82956, 29.9982, 75.4009, false),
  ('Q259030', 'Moga', 'Punjab', 'Moga', 163397, 30.8167, 75.17, false),
  ('Q1647167', 'Pathankot', 'Punjab', 'Pathankot', 155909, 32.2689, 75.6497, false),
  ('Q2719362', 'Sujanpur', 'Punjab', 'Pathankot', null, 32.3127, 75.6012, false),
  ('Q1023691', 'Nabha', 'Punjab', 'Patiala', null, 30.37, 76.15, false),
  ('Q208162', 'Patiala', 'Punjab', 'Patiala', 406192, 30.5667, 76.6333, false),
  ('Q589664', 'Anandpur Sahib', 'Punjab', 'Rupnagar', null, 31.23, 76.5, false),
  ('Q6414869', 'Kiratpur Sahib', 'Punjab', 'Rupnagar', null, 31.1821, 76.5635, false),
  ('Q2311518', 'Nangal', 'Punjab', 'Rupnagar', null, 31.37, 76.38, false),
  ('Q2341875', 'Rupnagar', 'Punjab', 'Rupnagar', 61314, 30.9664, 76.5331, false),
  ('Q1949069', 'Mohali', 'Punjab', 'Sahibzada Ajit Singh Nagar', 146213, 30.7194, 76.7181, false),
  ('Q2317411', 'Zirakpur', 'Punjab', 'Sahibzada Ajit Singh Nagar', null, 30.65, 76.82, false),
  ('Q2441398', 'Sangrur', 'Punjab', 'Sangrur', null, 30.2333, 75.8333, false),
  ('Q512825', 'Sunam', 'Punjab', 'Sangrur', null, 30.13, 75.8, false),
  ('Q2349902', 'Malout', 'Punjab', 'Sri Muktsar Sahib', 70958, 30.19, 74.499, false),
  ('Q17067419', 'Chabhal Kalan', 'Punjab', 'Tarn Taran', null, 31.4798, 74.7943, false),
  ('Q581774', 'Khemkaran', 'Punjab', 'Tarn Taran', 11938, 31.16, 74.66, false),
  ('Q2341728', 'Tarn Taran Sahib', 'Punjab', 'Tarn Taran', null, 31.4491, 74.9205, false),
  ('Q200049', 'Ajmer', 'Rajasthan', 'Ajmer', 542321, 26.468, 74.639, false),
  ('Q106362946', 'Ghooghra', 'Rajasthan', 'Ajmer', null, 26.4851, 74.5515, false),
  ('Q927794', 'Kishangarh', 'Rajasthan', 'Ajmer', null, 26.5739, 74.8667, false),
  ('Q749170', 'Pushkar', 'Rajasthan', 'Ajmer', 21626, 26.4903, 74.5542, false),
  ('Q2722762', 'Alwar', 'Rajasthan', 'Alwar', 341422, 27.5667, 76.6167, false),
  ('Q12063672', 'Neemrana', 'Rajasthan', 'Alwar', null, 27.9889, 76.3883, false),
  ('Q27962588', 'Reni, Alwar', 'Rajasthan', 'Alwar', null, 27.161, 76.713, false),
  ('Q2719176', 'Tijara', 'Rajasthan', 'Alwar', null, 27.93, 76.85, false),
  ('Q638695', 'Balotra', 'Rajasthan', 'Balotra', null, 25.83, 72.23, false),
  ('Q12414115', 'Arthuna', 'Rajasthan', 'Banswara', null, 23.4982, 74.0961, false),
  ('Q24928005', 'Atru', 'Rajasthan', 'Baran', null, 24.8667, 76.6667, false),
  ('Q1816726', 'Baran', 'Rajasthan', 'Baran', null, 25.1, 76.5167, false),
  ('Q808365', 'Barmer', 'Rajasthan', 'Barmer', 96225, 25.7444, 71.3972, false),
  ('Q6935588', 'Munabao', 'Rajasthan', 'Barmer', null, 25.75, 70.2833, false),
  ('Q757855', 'Beawar', 'Rajasthan', 'Beawar', 151472, 26.1011, 74.3203, false),
  ('Q559834', 'Bharatpur', 'Rajasthan', 'Bharatpur', 252342, 27.2172, 77.49, false),
  ('Q48731649', 'Rupbas', 'Rajasthan', 'Bharatpur', null, 26.9833, 77.5833, false),
  ('Q48731537', 'Uchain', 'Rajasthan', 'Bharatpur', null, 27.0931, 77.4097, false),
  ('Q1623188', 'Weir', 'Rajasthan', 'Bharatpur', null, 27.0186, 77.1764, false),
  ('Q589902', 'Asind', 'Rajasthan', 'Bhilwara', null, 25.73, 74.33, false),
  ('Q18003274', 'Badnor', 'Rajasthan', 'Bhilwara', null, 25.8355, 74.2775, false),
  ('Q25313782', 'Bagor', 'Rajasthan', 'Bhilwara', null, 25.3575, 74.3731, false),
  ('Q760146', 'Bhilwara', 'Rajasthan', 'Bhilwara', 359483, 25.35, 74.6333, false),
  ('Q96391778', 'Mandal', 'Rajasthan', 'Bhilwara', null, 25.4392, 74.5844, false),
  ('Q200718', 'Bikaner', 'Rajasthan', 'Bikaner', 529007, 28.0181, 73.3169, false),
  ('Q1749714', 'Nokha', 'Rajasthan', 'Bikaner', null, 27.6, 73.42, false),
  ('Q862612', 'Bundi', 'Rajasthan', 'Bundi', 103286, 25.4383, 75.6372, false),
  ('Q41827', 'Chittorgarh', 'Rajasthan', 'Chittorgarh', 116406, 24.8894, 74.6239, false),
  ('Q2554975', 'Rawatbhata', 'Rajasthan', 'Chittorgarh', null, 24.9319, 75.5889, false),
  ('Q3813160', 'Rajgarh', 'Rajasthan', 'Churu', null, 28.64, 75.38, false),
  ('Q7508587', 'Sidhmukh', 'Rajasthan', 'Churu', 7767, 28.95, 75.46, false),
  ('Q28154023', 'Nangal Rajawatan', 'Rajasthan', 'Dausa', null, 26.7486, 76.3273, false),
  ('Q1192807', 'Deeg', 'Rajasthan', 'Deeg', null, 27.4764, 77.3278, false),
  ('Q24927921', 'Pahadi', 'Rajasthan', 'Deeg', null, 27.7104, 77.0818, false),
  ('Q707848', 'Bari', 'Rajasthan', 'Dholpur', null, 26.63, 77.62, false),
  ('Q1264412', 'Dholpur', 'Rajasthan', 'Dholpur', null, 26.7, 77.9, false),
  ('Q741991', 'Dungarpur', 'Rajasthan', 'Dungarpur', null, 23.8431, 73.7144, false),
  ('Q1707848', 'Hanumangarh', 'Rajasthan', 'Hanumangarh', 129654, 29.5833, 74.3167, false),
  ('Q667224', 'Rawatsar', 'Rajasthan', 'Hanumangarh', null, 29.28, 74.38, false),
  ('Q8197166', 'Amber', 'Rajasthan', 'Jaipur', null, 26.9833, 75.8667, false),
  ('Q4868132', 'Bassi', 'Rajasthan', 'Jaipur', null, 26.8315, 76.0486, false),
  ('Q66485', 'Jaipur', 'Rajasthan', 'Jaipur', 3073350, 26.915, 75.82, false),
  ('Q24944517', 'Mauzmabad', 'Rajasthan', 'Jaipur', null, 26.6735, 75.3602, false),
  ('Q242898', 'Jaisalmer', 'Rajasthan', 'Jaisalmer', 65471, 26.9167, 70.9167, false),
  ('Q1779576', 'Pokhran', 'Rajasthan', 'Jaisalmer', 19186, 26.9194, 71.9208, false),
  ('Q122475547', 'Sam, Jaisalmer', 'Rajasthan', 'Jaisalmer', null, 26.8167, 70.5, false),
  ('Q4917336', 'Bishangarh', 'Rajasthan', 'Jalore', null, 25.4447, 72.5681, false),
  ('Q141163176', 'Jalore', 'Rajasthan', 'Jalore', null, 25.3466, 72.6179, false),
  ('Q587185', 'Aklera', 'Rajasthan', 'Jhalawar', null, 24.4158, 76.5667, false),
  ('Q26787497', 'Khanpur', 'Rajasthan', 'Jhalawar', null, 24.7324, 76.396, false),
  ('Q24937260', 'Raipur, Jhalawar', 'Rajasthan', 'Jhalawar', null, 24.6094, 76.2972, false),
  ('Q1006350', 'Jhunjhunu', 'Rajasthan', 'Jhunjhunu', null, 28.1256, 75.3978, false),
  ('Q2233964', 'Nawalgarh', 'Rajasthan', 'Jhunjhunu', 63948, 27.85, 75.27, false),
  ('Q1936947', 'Pilani', 'Rajasthan', 'Jhunjhunu', null, 28.37, 75.6, false),
  ('Q112788336', 'Borunda', 'Rajasthan', 'Jodhpur', null, 26.284, 73.4818, false),
  ('Q200019', 'Jodhpur', 'Rajasthan', 'Jodhpur', 1033918, 26.2944, 73.0278, false),
  ('Q48733848', 'Samrau', 'Rajasthan', 'Jodhpur', null, 26.8661, 72.7206, false),
  ('Q796497', 'Bilara', 'Rajasthan', 'Jodhpur Gramin', null, 26.1792, 73.7056, false),
  ('Q7106673', 'Osian', 'Rajasthan', 'Jodhpur Gramin', null, 26.7253, 72.9106, false),
  ('Q1709662', 'Hindaun', 'Rajasthan', 'Karauli', null, 26.72, 77.02, false),
  ('Q24906794', 'Shri Mahaveer Ji', 'Rajasthan', 'Karauli', null, 26.6833, 76.9167, false),
  ('Q330531', 'Kota', 'Rajasthan', 'Kota', 1001694, 25.18, 75.83, false),
  ('Q2544533', 'Viratnagar', 'Rajasthan', 'Kotputli-Behror', null, 27.45, 76.18, false),
  ('Q2544240', 'Merta City', 'Rajasthan', 'Nagaur', null, 26.65, 74.0333, false),
  ('Q6634626', 'Pali', 'Rajasthan', 'Pali', 229956, 25.7725, 73.3233, false),
  ('Q986875', 'Chhoti Sadri', 'Rajasthan', 'Pratapgarh', null, 24.38, 74.7, false),
  ('Q946827', 'Sawai Madhopur', 'Rajasthan', 'Sawai Madhopur', null, 26.0211, 76.3536, false),
  ('Q2720811', 'Fatehpur', 'Rajasthan', 'Sikar', null, 27.9972, 74.9611, false),
  ('Q2120436', 'Khandela', 'Rajasthan', 'Sikar', null, 27.605, 75.502, false),
  ('Q28173162', 'Sanwali', 'Rajasthan', 'Sikar', null, 27.5691, 75.1561, false),
  ('Q33334', 'Sikar', 'Rajasthan', 'Sikar', null, 27.6119, 75.1397, false),
  ('Q940829', 'Sirohi', 'Rajasthan', 'Sirohi', 35531, 24.8833, 72.8667, false),
  ('Q2625396', '1 SGM', 'Rajasthan', 'Sri Ganganagar', null, 29.3786, 73.8603, false),
  ('Q490883', 'Sri Ganganagar', 'Rajasthan', 'Sri Ganganagar', 249914, 29.92, 73.875, false),
  ('Q1000511', 'Tonk', 'Rajasthan', 'Tonk', 165363, 26.1667, 75.7833, false),
  ('Q28182701', 'Abapura', 'Rajasthan', 'Udaipur', null, 23.4383, 74.5188, false),
  ('Q11908904', 'Bedla', 'Rajasthan', 'Udaipur', null, 24.6333, 73.7, false),
  ('Q31213664', 'Semari', 'Rajasthan', 'Udaipur', null, 24.0555, 73.8566, false),
  ('Q200340', 'Udaipur', 'Rajasthan', 'Udaipur', 451100, 24.5833, 73.6833, false),
  ('Q48731152', 'Bhaiseena', 'Rajasthan', null, null, 27.0361, 77.0528, false),
  ('Q24810366', 'Daudpur', 'Rajasthan', null, null, 25.9059, 84.594, false),
  ('Q26789484', 'Govindgarh', 'Rajasthan', null, null, 27.5042, 76.9994, false),
  ('Q27644414', 'Palsana', 'Rajasthan', null, null, 27.4826, 75.38, false),
  ('Q186141', 'Gangtok', 'Sikkim', 'Gangtok', 100286, 27.33, 88.62, false),
  ('Q2483862', 'Namchi', 'Sikkim', 'Namchi', 12190, 27.17, 88.35, false),
  ('Q2726240', 'Rangpo', 'Sikkim', 'Pakyong', 10450, 27.18, 88.53, false),
  ('Q3248884', 'Rhenock', 'Sikkim', 'Pakyong', null, 27.17, 88.64, false),
  ('Q24929455', 'Rongli', 'Sikkim', 'Pakyong', null, 27.2037, 88.7015, false),
  ('Q888769', 'Chengalpattu', 'Tamil Nadu', 'Chengalpattu', null, 12.6906, 79.9778, false),
  ('Q4992182', 'Sadras', 'Tamil Nadu', 'Chengalpattu', null, 12.525, 80.1622, false),
  ('Q2229754', 'Tambaram', 'Tamil Nadu', 'Chengalpattu', null, 12.93, 80.11, false),
  ('Q6301484', 'Tirukalukundram', 'Tamil Nadu', 'Chengalpattu', null, 12.6067, 80.0625, false),
  ('Q2715977', 'Urapakkam', 'Tamil Nadu', 'Chengalpattu', null, 12.8672, 80.0716, false),
  ('Q2541049', 'Vandalur', 'Tamil Nadu', 'Chengalpattu', null, 12.89, 80.08, false),
  ('Q3006626', 'Arumbakkam', 'Tamil Nadu', 'Chennai', null, 13.0735, 80.2064, false),
  ('Q1352', 'Chennai', 'Tamil Nadu', 'Chennai', 6599000, 13.0825, 80.275, true),
  ('Q3006619', 'Choolaimedu', 'Tamil Nadu', 'Chennai', null, 13.0628, 80.2275, false),
  ('Q2231394', 'Madipakkam', 'Tamil Nadu', 'Chennai', null, 12.9649, 80.1961, false),
  ('Q3530475', 'Perambur', 'Tamil Nadu', 'Chennai', null, 13.1122, 80.2449, false),
  ('Q3166683', 'Saidapet', 'Tamil Nadu', 'Chennai', null, 13.0235, 80.2237, false),
  ('Q4739739', 'Tharamani', 'Tamil Nadu', 'Chennai', null, 12.9786, 80.2409, false),
  ('Q282212', 'Vaniyambadi', 'Tamil Nadu', 'Chennai', null, 12.68, 78.62, false),
  ('Q9885', 'Coimbatore', 'Tamil Nadu', 'Coimbatore', 959823, 11.0008, 76.9633, false),
  ('Q9824', 'Erode', 'Tamil Nadu', 'Coimbatore', 157101, 11.3408, 77.7172, false),
  ('Q112621832', 'Kanthe Gounden Chavadi', 'Tamil Nadu', 'Coimbatore', null, 10.8725, 76.8909, false),
  ('Q566051', 'Kurichi', 'Tamil Nadu', 'Coimbatore', null, 10.96, 77.01, false),
  ('Q126393486', 'Makkinampatti', 'Tamil Nadu', 'Coimbatore', null, 10.6528, 77.0306, false),
  ('Q198131', 'Mettupalayam', 'Tamil Nadu', 'Coimbatore', null, 11.3056, 76.935, false),
  ('Q7092201', 'Ondipudur', 'Tamil Nadu', 'Coimbatore', null, 10.9, 76.97, false),
  ('Q1661840', 'Podanur', 'Tamil Nadu', 'Coimbatore', null, 10.95, 76.9833, false),
  ('Q298780', 'Pollachi', 'Tamil Nadu', 'Coimbatore', null, 10.659, 77.008, false),
  ('Q2231112', 'Sirumugai', 'Tamil Nadu', 'Coimbatore', null, 11.3178, 77.0067, false),
  ('Q2715755', 'Thondamuthur', 'Tamil Nadu', 'Coimbatore', 8386, 10.9899, 76.8409, false),
  ('Q836527', 'Tiruppur', 'Tamil Nadu', 'Coimbatore', null, 11.1075, 77.3398, false),
  ('Q282137', 'Valparai', 'Tamil Nadu', 'Coimbatore', null, 10.37, 76.97, false),
  ('Q4657770', 'Walayar', 'Tamil Nadu', 'Coimbatore', null, 10.8456, 76.8381, false),
  ('Q279951', 'Cuddalore', 'Tamil Nadu', 'Cuddalore', 173676, 11.75, 79.75, false),
  ('Q2326755', 'Neyveli', 'Tamil Nadu', 'Cuddalore', 105687, 11.6, 79.48, false),
  ('Q2229494', 'Panruti', 'Tamil Nadu', 'Cuddalore', null, 11.77, 79.55, false),
  ('Q2542786', 'Parangipettai', 'Tamil Nadu', 'Cuddalore', 25541, 11.49, 79.76, false),
  ('Q2716515', 'Srimushnam', 'Tamil Nadu', 'Cuddalore', null, 11.4, 79.42, false),
  ('Q2716042', 'Vadalur', 'Tamil Nadu', 'Cuddalore', null, 11.7431, 79.7656, false),
  ('Q9894', 'Dharmapuri', 'Tamil Nadu', 'Dharmapuri', 64444, 12.127, 78.158, false),
  ('Q1707447', 'Harur', 'Tamil Nadu', 'Dharmapuri', null, 12.052, 78.4855, false),
  ('Q2716945', 'Pappireddipatti', 'Tamil Nadu', 'Dharmapuri', null, 11.9119, 78.366, false),
  ('Q298596', 'Batlagundu', 'Tamil Nadu', 'Dindigul', null, 10.1655, 77.7594, false),
  ('Q253851', 'Kodaikanal', 'Tamil Nadu', 'Dindigul', 36501, 10.2333, 77.4833, false),
  ('Q2541224', 'Nilakkottai', 'Tamil Nadu', 'Dindigul', null, 10.17, 77.87, false),
  ('Q298706', 'Palani', 'Tamil Nadu', 'Dindigul', 70467, 10.4504, 77.5104, false),
  ('Q490708', 'V.S.K.Valasai', 'Tamil Nadu', 'Dindigul', null, 10.3154, 78.1513, false),
  ('Q254244', 'Gobichettipalayam', 'Tamil Nadu', 'Erode', null, 11.4536, 77.4383, false),
  ('Q28174016', 'Mettunasuvanpalayam', 'Tamil Nadu', 'Erode', null, 11.4325, 77.6658, false),
  ('Q2716706', 'Punjai Puliampatti', 'Tamil Nadu', 'Erode', null, 11.3517, 77.1667, false),
  ('Q24943187', 'Sivagiri-Erode', 'Tamil Nadu', 'Erode', null, 11.12, 77.8, false),
  ('Q130577', 'Chinnasalem', 'Tamil Nadu', 'Kallakurichi', null, 11.6333, 78.8722, false),
  ('Q2308206', 'Kallakurichi', 'Tamil Nadu', 'Kallakurichi', null, 11.7404, 78.959, false),
  ('Q4939784', 'Bollineni Hillside', 'Tamil Nadu', 'Kanchipuram', null, 12.8803, 80.2024, false),
  ('Q1612550', 'Kalpakkam', 'Tamil Nadu', 'Kanchipuram', null, 12.5576, 80.1754, false),
  ('Q212332', 'Kanchipuram', 'Tamil Nadu', 'Kanchipuram', 164384, 12.8308, 79.7078, false),
  ('Q2242785', 'Maduranthakam', 'Tamil Nadu', 'Kanchipuram', null, 12.5101, 79.8849, false),
  ('Q208000', 'Mahabalipuram', 'Tamil Nadu', 'Kanchipuram', 15172, 12.6197, 80.1944, false),
  ('Q2547993', 'Sriperumbudur', 'Tamil Nadu', 'Kanchipuram', null, 12.97, 79.95, false),
  ('Q2716139', 'Thiruporur', 'Tamil Nadu', 'Kanchipuram', null, 12.7209, 80.1867, false),
  ('Q264443', 'Uthiramerur', 'Tamil Nadu', 'Kanchipuram', null, 12.6, 79.7667, false),
  ('Q582661', 'Anjugramam', 'Tamil Nadu', 'Kanniyakumari', null, 8.1183, 77.5303, false),
  ('Q2443995', 'Kallukoottam', 'Tamil Nadu', 'Kanniyakumari', null, 8.1893, 77.2896, false),
  ('Q222267', 'Kanniyakumari', 'Tamil Nadu', 'Kanniyakumari', 19678, 8.0911, 77.5417, false),
  ('Q2230820', 'Kuzhithura', 'Tamil Nadu', 'Kanniyakumari', null, 8.3167, 77.2, false),
  ('Q7288981', 'Ramanputhoor', 'Tamil Nadu', 'Kanniyakumari', null, 8.1703, 77.4256, false),
  ('Q2548004', 'Suchindram', 'Tamil Nadu', 'Kanniyakumari', null, 8.155, 77.465, false),
  ('Q2541093', 'Thiruvattar', 'Tamil Nadu', 'Kanniyakumari', null, 8.33, 77.26, false),
  ('Q576435', 'Thiruvithamcode', 'Tamil Nadu', 'Kanniyakumari', null, 8.2483, 77.2972, false),
  ('Q585920', 'Aravakurichi', 'Tamil Nadu', 'Karur', null, 10.77, 77.92, false),
  ('Q817218', 'Karur', 'Tamil Nadu', 'Karur', null, 10.96, 78.075, false),
  ('Q1190831', 'Denkanikottai', 'Tamil Nadu', 'Krishnagiri', null, 12.5267, 77.7928, false),
  ('Q7709698', 'Thalli', 'Tamil Nadu', 'Krishnagiri', null, 12.5801, 77.6642, false),
  ('Q591467', 'Andipatti', 'Tamil Nadu', 'Madurai', null, 9.98, 77.6081, false),
  ('Q228405', 'Madurai', 'Tamil Nadu', 'Madurai', 1561129, 9.9197, 78.1194, false),
  ('Q2543146', 'Sholavandan', 'Tamil Nadu', 'Madurai', null, 10.0167, 77.9667, false),
  ('Q2716943', 'Tirumangalam', 'Tamil Nadu', 'Madurai', null, 9.81, 77.98, false),
  ('Q339986', 'Mayiladuthurai', 'Tamil Nadu', 'Mayiladuthurai', 85632, 11.1019, 79.65, false),
  ('Q1278427', 'Sirkazhi', 'Tamil Nadu', 'Mayiladuthurai', null, 11.2333, 79.7333, false),
  ('Q732594', 'Tharangambadi', 'Tamil Nadu', 'Mayiladuthurai', null, 11.0325, 79.8531, false),
  ('Q695585', 'Nagapattinam', 'Tamil Nadu', 'Nagapattinam', 102905, 10.7667, 79.8333, false),
  ('Q1510885', 'Velankanni', 'Tamil Nadu', 'Nagapattinam', null, 10.6667, 79.8167, false),
  ('Q2236175', 'Komarapalayam', 'Tamil Nadu', 'Namakkal', null, 11.4433, 77.7114, false),
  ('Q745078', 'Mallasamudram', 'Tamil Nadu', 'Namakkal', null, 11.48, 78.03, false),
  ('Q9923', 'Namakkal', 'Tamil Nadu', 'Namakkal', null, 11.2333, 78.1667, false),
  ('Q2716992', 'Pallipalayam', 'Tamil Nadu', 'Namakkal', null, 11.3646, 77.7479, false),
  ('Q2716115', 'Sendamangalam', 'Tamil Nadu', 'Namakkal', null, 11.2801, 78.2348, false),
  ('Q278964', 'Coonoor', 'Tamil Nadu', 'Nilgiris', null, 11.345, 76.795, false),
  ('Q2407283', 'Gudalur', 'Tamil Nadu', 'Nilgiris', null, 11.5, 76.5, false),
  ('Q2135487', 'Ketti', 'Tamil Nadu', 'Nilgiris', null, 11.4, 76.7, false),
  ('Q2232119', 'Kilkunda', 'Tamil Nadu', 'Nilgiris', 10150, 11.2569, 76.6697, false),
  ('Q279106', 'Kotagiri', 'Tamil Nadu', 'Nilgiris', 28207, 11.4167, 76.8667, false),
  ('Q9888', 'Ooty', 'Tamil Nadu', 'Nilgiris', 88430, 11.4086, 76.6939, false),
  ('Q2716012', 'Sholur', 'Tamil Nadu', 'Nilgiris', null, 11.4833, 76.656, false),
  ('Q2541562', 'Nathampannai', 'Tamil Nadu', 'Pudukkottai', null, 10.4088, 78.7918, false),
  ('Q921719', 'Pudukkottai', 'Tamil Nadu', 'Pudukkottai', null, 10.3833, 78.8167, false),
  ('Q1629209', 'Thirumayam', 'Tamil Nadu', 'Pudukkottai', null, 10.2471, 78.7505, false),
  ('Q1207562', 'Dhanushkodi', 'Tamil Nadu', 'Ramanathapuram', null, 9.1778, 79.4167, false),
  ('Q18126608', 'Karkathakudi', 'Tamil Nadu', 'Ramanathapuram', null, 9.7417, 78.8807, false),
  ('Q2135478', 'Kilakarai', 'Tamil Nadu', 'Ramanathapuram', null, 9.2314, 78.7844, false),
  ('Q1435144', 'Rameswaram', 'Tamil Nadu', 'Ramanathapuram', 44856, 9.28, 79.3, false),
  ('Q589185', 'Arcot', 'Tamil Nadu', 'Ranipet', null, 12.9, 79.3333, false),
  ('Q583466', 'Ayothiapattinam', 'Tamil Nadu', 'Salem', null, 11.6581, 78.2436, false),
  ('Q9904', 'Edappadi', 'Tamil Nadu', 'Salem', null, 11.5849, 77.8382, false),
  ('Q2443959', 'Kolathur', 'Tamil Nadu', 'Salem', null, 11.51, 77.45, false),
  ('Q2541501', 'Mecheri', 'Tamil Nadu', 'Salem', null, 11.8508, 77.9564, false),
  ('Q9986', 'Omalur', 'Tamil Nadu', 'Salem', null, 11.73, 78.07, false),
  ('Q2716428', 'Pethanaickenpalayam', 'Tamil Nadu', 'Salem', null, 11.6644, 78.4989, false),
  ('Q2716289', 'Poolampatti', 'Tamil Nadu', 'Salem', null, 11.6533, 77.7731, false),
  ('Q9863', 'Salem', 'Tamil Nadu', 'Salem', 693236, 11.65, 78.1667, false),
  ('Q9847', 'Sankagiri', 'Tamil Nadu', 'Salem', null, 11.48, 77.87, false),
  ('Q7918184', 'Veerapandi', 'Tamil Nadu', 'Salem', null, 11.5755, 78.0683, false),
  ('Q2242819', 'Ilaiyangudi', 'Tamil Nadu', 'Sivaganga', null, 9.63, 78.63, false),
  ('Q1023693', 'Karaikudi', 'Tamil Nadu', 'Sivaganga', 106714, 10.0667, 78.7833, false),
  ('Q1025396', 'Sivaganga', 'Tamil Nadu', 'Sivaganga', 40129, 9.85, 78.5, false),
  ('Q7809396', 'Tirupathur', 'Tamil Nadu', 'Sivaganga', null, 10.0667, 78.7833, false),
  ('Q2231535', 'Sankarankovil', 'Tamil Nadu', 'Tenkasi', null, 9.1778, 77.5351, false),
  ('Q2715986', 'Surandai', 'Tamil Nadu', 'Tenkasi', null, 8.97, 77.4, false),
  ('Q1320672', 'Ayyampettai', 'Tamil Nadu', 'Thanjavur', null, 10.9, 79.18, false),
  ('Q224850', 'Darasuram', 'Tamil Nadu', 'Thanjavur', null, 10.9515, 79.3562, false),
  ('Q913399', 'Kudanthaiyan', 'Tamil Nadu', 'Thanjavur', null, 10.9667, 79.3833, false),
  ('Q2717803', 'Papanasam', 'Tamil Nadu', 'Thanjavur', null, 10.9333, 79.2833, false),
  ('Q2716752', 'Peravurani', 'Tamil Nadu', 'Thanjavur', null, 10.3, 79.18, false),
  ('Q41496', 'Thanjavur', 'Tamil Nadu', 'Thanjavur', 222943, 10.787, 79.1378, false),
  ('Q2229514', 'Thiruvaiyaru', 'Tamil Nadu', 'Thanjavur', null, 10.88, 79.1, false),
  ('Q2282438', 'Cumbum', 'Tamil Nadu', 'Theni', 68090, 9.73, 77.3, false),
  ('Q12989621', 'Highwavys', 'Tamil Nadu', 'Theni', null, 9.6378, 77.355, false),
  ('Q2543104', 'Periyakulam', 'Tamil Nadu', 'Theni', null, 10.12, 77.55, false),
  ('Q1553931', 'Theni Allinagaram', 'Tamil Nadu', 'Theni', 85424, 10.0, 77.4833, false),
  ('Q2443947', 'Kadambur', 'Tamil Nadu', 'Thoothukudi', null, 8.98, 77.87, false),
  ('Q130224826', 'Kodiyankulam', 'Tamil Nadu', 'Thoothukudi', null, 8.8423, 77.8316, false),
  ('Q2244024', 'Kovilpatti', 'Tamil Nadu', 'Thoothukudi', null, 9.17, 77.87, false),
  ('Q24906358', 'Maranthalai', 'Tamil Nadu', 'Thoothukudi', null, 8.621, 78.06, false),
  ('Q1792360', 'Thiruchendur', 'Tamil Nadu', 'Thoothukudi', null, 8.4833, 78.1167, false),
  ('Q41562', 'Thoothukudi', 'Tamil Nadu', 'Thoothukudi', null, 8.7833, 78.1333, false),
  ('Q24906380', 'Umarikadu', 'Tamil Nadu', 'Thoothukudi', null, 8.6261, 78.0601, false),
  ('Q2554965', 'Manapparai', 'Tamil Nadu', 'Tiruchirappalli', null, 10.6076, 78.4149, false),
  ('Q207754', 'Tiruchirappalli', 'Tamil Nadu', 'Tiruchirappalli', 916857, 10.8269, 78.6928, false),
  ('Q2283418', 'Kalakkad', 'Tamil Nadu', 'Tirunelveli', null, 8.512, 77.558, false),
  ('Q6353795', 'Kallidaikurichi', 'Tamil Nadu', 'Tirunelveli', null, 8.685, 77.465, false),
  ('Q6379062', 'Kavalkinaru', 'Tamil Nadu', 'Tirunelveli', null, 8.276, 77.581, false),
  ('Q2542321', 'Nanguneri', 'Tamil Nadu', 'Tirunelveli', null, 8.48, 77.67, false),
  ('Q15261696', 'Nerkattumseval', 'Tamil Nadu', 'Tirunelveli', null, 9.24, 77.53, false),
  ('Q7785290', 'Thirukkurungudi', 'Tamil Nadu', 'Tirunelveli', null, 8.45, 77.5667, false),
  ('Q213248', 'Tirunelveli', 'Tamil Nadu', 'Tirunelveli', 411298, 8.7289, 77.7081, false),
  ('Q7918155', 'Veerakeralampudur', 'Tamil Nadu', 'Tirunelveli', null, 8.9365, 77.449, false),
  ('Q325951', 'Dharapuram', 'Tamil Nadu', 'Tiruppur', null, 10.73, 77.52, false),
  ('Q61064350', 'Kundadam', 'Tamil Nadu', 'Tiruppur', null, 10.8501, 77.4458, false),
  ('Q107647093', 'Uthiyur', 'Tamil Nadu', 'Tiruppur', 3500, 10.8972, 77.5283, false),
  ('Q2715119', 'Pallipattu', 'Tamil Nadu', 'Tiruvallur', null, 13.33, 79.45, false),
  ('Q2229614', 'Poonamallee', 'Tamil Nadu', 'Tiruvallur', null, 13.05, 80.11, false),
  ('Q2716489', 'Puzhal', 'Tamil Nadu', 'Tiruvallur', null, 13.1697, 80.2072, false),
  ('Q608181', 'Tiruvallur', 'Tamil Nadu', 'Tiruvallur', 54416, 13.15, 79.9167, false),
  ('Q12426867', 'Chetpet', 'Tamil Nadu', 'Tiruvannamalai', null, 12.4644, 79.3475, false),
  ('Q5094634', 'Cheyyar', 'Tamil Nadu', 'Tiruvannamalai', null, 12.658, 79.5424, false),
  ('Q5267053', 'Devikapuram', 'Tamil Nadu', 'Tiruvannamalai', null, 12.4744, 79.3475, false),
  ('Q7781401', 'Thennangur', 'Tamil Nadu', 'Tiruvannamalai', null, 12.5463, 79.6083, false),
  ('Q162830', 'Tiruvannamalai', 'Tamil Nadu', 'Tiruvannamalai', 145278, 12.25, 79.0833, false),
  ('Q2465640', 'Vandavasi', 'Tamil Nadu', 'Tiruvannamalai', null, 12.5, 79.62, false),
  ('Q2716554', 'Thiruthuraipoondi', 'Tamil Nadu', 'Tiruvarur', null, 10.53, 79.65, false),
  ('Q1025399', 'Thiruvarur', 'Tamil Nadu', 'Tiruvarur', null, 10.7667, 79.65, false),
  ('Q584854', 'Ambur', 'Tamil Nadu', 'Vellore', null, 12.78, 78.7, false),
  ('Q1707438', 'Gudiyatham', 'Tamil Nadu', 'Vellore', null, 12.9397, 78.8644, false),
  ('Q300577', 'Vellore', 'Tamil Nadu', 'Vellore', 484690, 12.9333, 79.1333, false),
  ('Q1524976', 'Gingee', 'Tamil Nadu', 'Viluppuram', 22045, 12.25, 79.4167, false),
  ('Q2236719', 'Kottakuppam', 'Tamil Nadu', 'Viluppuram', null, 11.9914, 79.8414, false),
  ('Q2465629', 'Tindivanam', 'Tamil Nadu', 'Viluppuram', null, 12.25, 79.65, false),
  ('Q584327', 'Aruppukkottai', 'Tamil Nadu', 'Virudhunagar', null, 9.51, 78.1, false),
  ('Q2237707', 'Rajapalayam', 'Tamil Nadu', 'Virudhunagar', null, 9.45, 77.55, false),
  ('Q2061870', 'Sivakasi', 'Tamil Nadu', 'Virudhunagar', null, 9.45, 77.8, false),
  ('Q589083', 'Ariyalur', 'Tamil Nadu', null, null, 11.1333, 79.0833, false),
  ('Q584494', 'Avadi', 'Tamil Nadu', null, null, 13.12, 80.1, false),
  ('Q727731', 'Colachel', 'Tamil Nadu', null, 23227, 8.1794, 77.2582, false),
  ('Q853945', 'Dindigul', 'Tamil Nadu', null, 207327, 10.362, 77.9736, false),
  ('Q1525589', 'Ettimadai', 'Tamil Nadu', null, null, 10.8981, 76.9003, false),
  ('Q2308195', 'Jolarpettai', 'Tamil Nadu', null, null, 12.56, 78.58, false),
  ('Q337305', 'Koodankulam', 'Tamil Nadu', null, 12957, 8.1903, 77.7, false),
  ('Q866403', 'Kovaipudur', 'Tamil Nadu', null, null, 10.9367, 76.9511, false),
  ('Q6442830', 'Kulasekharapatnam', 'Tamil Nadu', null, null, 8.4, 78.05, false),
  ('Q2554800', 'Muthupet', 'Tamil Nadu', null, null, 10.4, 79.5, false),
  ('Q847606', 'Nagercoil', 'Tamil Nadu', null, null, 8.1875, 77.4294, false),
  ('Q1815867', 'Padmanabhapuram', 'Tamil Nadu', null, null, 8.2514, 77.3247, false),
  ('Q1025402', 'Perambalur', 'Tamil Nadu', null, null, 11.2342, 78.8807, false),
  ('Q2117793', 'Pulicat', 'Tamil Nadu', null, null, 13.4167, 80.3167, false),
  ('Q2229686', 'Sholinghur', 'Tamil Nadu', null, null, 13.12, 79.42, false),
  ('Q2548014', 'Udumalaipettai', 'Tamil Nadu', null, null, 10.58, 77.24, false),
  ('Q16311342', 'Vadamalapuram', 'Tamil Nadu', null, null, 9.4944, 77.8451, false),
  ('Q494281', 'Adilabad', 'Telangana', 'Adilabad', 117167, 19.669, 78.5355, false),
  ('Q759677', 'Bellampalli', 'Telangana', 'Adilabad', 55841, 19.0558, 79.4931, false),
  ('Q1193652', 'Dasnapur', 'Telangana', 'Adilabad', 22216, 19.6536, 78.5114, false),
  ('Q3411652', 'Ichoda', 'Telangana', 'Adilabad', 12358, 19.4333, 78.4667, false),
  ('Q2290801', 'Kaghaznagar', 'Telangana', 'Adilabad', 57583, 19.3333, 79.4833, false),
  ('Q2483821', 'Mandamarri', 'Telangana', 'Adilabad', 52352, 18.9822, 79.4811, false),
  ('Q2563445', 'Naspur', 'Telangana', 'Adilabad', 31244, 18.83, 79.45, false),
  ('Q3412853', 'Utnur', 'Telangana', 'Adilabad', 16005, 19.3667, 78.7667, false),
  ('Q759204', 'Bhadrachalam', 'Telangana', 'Bhadradri Kothagudem', 50087, 17.6669, 80.8826, false),
  ('Q772160', 'Palvancha', 'Telangana', 'Bhadradri Kothagudem', 80199, 17.5963, 80.7087, false),
  ('Q3361894', 'Hanamakonda', 'Telangana', 'Hanamkonda', null, 18.0073, 79.5515, false),
  ('Q4850068', 'Balapur', 'Telangana', 'Hyderabad', null, 17.3102, 78.4997, false),
  ('Q1361', 'Hyderabad', 'Telangana', 'Hyderabad', 9191000, 17.3617, 78.4747, true),
  ('Q6428594', 'Kompally', 'Telangana', 'Hyderabad', 15575, 17.4993, 78.4583, false),
  ('Q56291123', 'Old Neredmet Village', 'Telangana', 'Hyderabad', null, 17.4717, 78.5364, false),
  ('Q2016650', 'Jagtial', 'Telangana', 'Jagtial', 103930, 18.8, 78.93, false),
  ('Q2235879', 'Koratla', 'Telangana', 'Jagtial', 66504, 18.8235, 78.7108, false),
  ('Q16343722', 'Metpalle', 'Telangana', 'Jagtial', 50902, 18.8297, 78.5878, false),
  ('Q5555597', 'Ghanpur', 'Telangana', 'Jangaon', null, 17.8565, 79.3717, false),
  ('Q2483796', 'Jangaon', 'Telangana', 'Jangaon', 52394, 17.72, 79.18, false),
  ('Q4902167', 'Bhupalapally', 'Telangana', 'Jayashankar Bhupalpally', 42387, 18.4314, 79.8605, false),
  ('Q14201843', 'Alampur', 'Telangana', 'Jogulamba Gadwal', null, 15.8799, 78.1335, false),
  ('Q1525224', 'Gadwal', 'Telangana', 'Jogulamba Gadwal', 63177, 16.23, 77.8, false),
  ('Q3428074', 'Yellareddy', 'Telangana', 'Kamareddy', 14923, 18.1859, 78.0212, false),
  ('Q5576202', 'Godavarikhani', 'Telangana', 'Karimnagar', 252693, 18.7519, 79.5133, false),
  ('Q3430080', 'Huzurabad', 'Telangana', 'Karimnagar', 37665, 18.2, 79.42, false),
  ('Q721357', 'Jallaram Kamanpur', 'Telangana', 'Karimnagar', null, 18.6875, 79.5411, false),
  ('Q16039783', 'Karimnagar', 'Telangana', 'Karimnagar', 289821, 18.4355, 79.1337, false),
  ('Q2563435', 'Sircilla', 'Telangana', 'Karimnagar', 83186, 18.3884, 78.814, false),
  ('Q970934', 'Chunchupalle', 'Telangana', 'Khammam', 19944, 17.5236, 80.605, false),
  ('Q5285655', 'Karepalli', 'Telangana', 'Khammam', null, 17.5101, 80.272, false),
  ('Q1921496', 'Khammam', 'Telangana', 'Khammam', 196283, 17.25, 80.15, false),
  ('Q24950923', 'Khanapuram Haveli', 'Telangana', 'Khammam', null, 17.2719, 80.1798, false),
  ('Q2238988', 'Kothagudem', 'Telangana', 'Khammam', 79819, 17.55, 80.63, false),
  ('Q61634427', 'Madhira', 'Telangana', 'Khammam', null, 16.9167, 80.3667, false),
  ('Q2483781', 'Manuguru', 'Telangana', 'Khammam', 32091, 17.9373, 80.8185, false),
  ('Q3430076', 'Mudigonda', 'Telangana', 'Khammam', 6031, 17.1833, 80.0916, false),
  ('Q3430011', 'Nelakondapalli', 'Telangana', 'Khammam', 7767, 17.1, 80.0506, false),
  ('Q2734077', 'Sarapaka', 'Telangana', 'Khammam', 22149, 17.6922, 80.8614, false),
  ('Q3430056', 'Wyra', 'Telangana', 'Khammam', null, 17.1943, 80.3591, false),
  ('Q721480', 'Yellandu', 'Telangana', 'Khammam', 35056, 17.6, 80.33, false),
  ('Q589709', 'Asifabad', 'Telangana', 'Kumaram Bheem Asifabad', 23059, 19.3585, 79.2841, false),
  ('Q6124094', 'Jainoor', 'Telangana', 'Kumaram Bheem Asifabad', 6342, 19.3981, 78.9708, false),
  ('Q26789867', 'Dornakal', 'Telangana', 'Mahabubabad', 14425, 17.4447, 80.1492, false),
  ('Q6732721', 'Mahabubabad', 'Telangana', 'Mahabubabad', 42851, 17.5973, 80.0021, false),
  ('Q7796732', 'Thorrur', 'Telangana', 'Mahabubabad', 19100, 17.5857, 79.6578, false),
  ('Q585398', 'Badepalle', 'Telangana', 'Mahabubnagar', 32598, 16.7544, 78.1479, false),
  ('Q3425942', 'Chinna Chintakunta', 'Telangana', 'Mahabubnagar', 5637, 17.7797, 78.2744, false),
  ('Q1525398', 'Farooqnagar', 'Telangana', 'Mahabubnagar', 45675, 17.0778, 78.2011, false),
  ('Q3416192', 'Jadcherla', 'Telangana', 'Mahabubnagar', 17958, 16.7667, 78.15, false),
  ('Q2768192', 'Mahabubnagar', 'Telangana', 'Mahabubnagar', 190400, 16.7333, 77.9833, false),
  ('Q11038078', 'Chennur', 'Telangana', 'Mancherial', 23579, 18.8535, 79.7826, false),
  ('Q2893051', 'Kasipet', 'Telangana', 'Mancherial', 5133, 19.0333, 79.4667, false),
  ('Q6706382', 'Luxettipet', 'Telangana', 'Mancherial', 11322, 18.8667, 79.2167, false),
  ('Q720842', 'Mancherial', 'Telangana', 'Mancherial', 110000, 18.8721, 79.4472, false),
  ('Q55633480', 'Somagudem', 'Telangana', 'Mancherial', null, 19.0716, 79.4912, false),
  ('Q4768010', 'Annaram', 'Telangana', 'Medak', 6840, 17.6288, 78.3759, false),
  ('Q3422611', 'Chegunta', 'Telangana', 'Medak', 5747, 17.9713, 78.4618, false),
  ('Q28172773', 'Kowdipalle', 'Telangana', 'Medak', null, 17.8961, 78.21, false),
  ('Q720824', 'Patancheru', 'Telangana', 'Medak', null, 17.53, 78.27, false),
  ('Q2229196', 'Sadasivpet', 'Telangana', 'Medak', 47920, 17.6167, 77.95, false),
  ('Q260547', 'Siddipet', 'Telangana', 'Medak', 66737, 18.1, 78.85, false),
  ('Q16316026', 'Bachupally', 'Telangana', 'Medchal-Malkajgiri', 27563, 17.5468, 78.365, false),
  ('Q4936764', 'Boduppal', 'Telangana', 'Medchal-Malkajgiri', 43692, 17.4139, 78.5783, false),
  ('Q5314876', 'Dundigal', 'Telangana', 'Medchal-Malkajgiri', 13465, 17.5781, 78.4288, false),
  ('Q1707290', 'Ghatkeser', 'Telangana', 'Medchal-Malkajgiri', 19763, 17.4494, 78.6853, false),
  ('Q6166003', 'Jawaharnagar Secunderabad', 'Telangana', 'Medchal-Malkajgiri', 44562, 17.5092, 78.5542, false),
  ('Q3430279', 'Medchal', 'Telangana', 'Medchal-Malkajgiri', 35611, 17.6297, 78.4814, false),
  ('Q6806994', 'Medipally', 'Telangana', 'Medchal-Malkajgiri', 10787, 17.7989, 78.805, false),
  ('Q6958534', 'Nagaram', 'Telangana', 'Medchal-Malkajgiri', 30502, 17.4875, 78.6012, false),
  ('Q7160468', 'Peerzadiguda', 'Telangana', 'Medchal-Malkajgiri', 32586, 17.3974, 78.5783, false),
  ('Q12992841', 'Kamalapuram', 'Telangana', 'Mulugu', 11493, 18.2925, 80.4608, false),
  ('Q4673455', 'Achampet', 'Telangana', 'Nagarkurnool', 20721, 16.6299, 80.1213, false),
  ('Q6354782', 'Kalwakurthy', 'Telangana', 'Nagarkurnool', 28060, 16.65, 78.48, false),
  ('Q3413618', 'Kollapur', 'Telangana', 'Nagarkurnool', 4732, 16.1046, 78.3206, false),
  ('Q16315268', 'Nagarkarnool', 'Telangana', 'Nagarkurnool', 26801, 16.4871, 78.3119, false),
  ('Q31502217', 'Nagarkurnool', 'Telangana', 'Nagarkurnool', null, 16.4939, 78.3102, false),
  ('Q721388', 'Chandur', 'Telangana', 'Nalgonda', 10880, 16.98, 79.06, false),
  ('Q3416958', 'Chityal', 'Telangana', 'Nalgonda', 13752, 17.2333, 79.1333, false),
  ('Q1254798', 'Devarakonda', 'Telangana', 'Nalgonda', 29731, 16.6919, 78.9207, false),
  ('Q15528101', 'Miryalaguda', 'Telangana', 'Nalgonda', 104918, 16.525, 79.354, false),
  ('Q3418811', 'Nakrekal', 'Telangana', 'Nalgonda', 29126, 17.1667, 79.4333, false),
  ('Q1949850', 'Nalgonda', 'Telangana', 'Nalgonda', 154326, 17.05, 79.27, false),
  ('Q2046416', 'Vijayapuri North', 'Telangana', 'Nalgonda', 15887, 16.6028, 79.3075, false),
  ('Q2576114', 'Basara', 'Telangana', 'Nirmal', 5865, 18.8833, 77.95, false),
  ('Q759999', 'Bhainsa', 'Telangana', 'Nirmal', 49764, 19.1, 77.9667, false),
  ('Q2087729', 'Nirmal', 'Telangana', 'Nirmal', 88433, 19.1, 78.35, false),
  ('Q3429927', 'Armoor', 'Telangana', 'Nizamabad', 64023, 18.79, 78.29, false),
  ('Q3428196', 'Banswada', 'Telangana', 'Nizamabad', 28384, 18.3833, 77.8833, false),
  ('Q859167', 'Bodhan', 'Telangana', 'Nizamabad', 77573, 18.67, 77.9, false),
  ('Q2564921', 'Kamareddy', 'Telangana', 'Nizamabad', 80315, 18.32, 78.3418, false),
  ('Q41473', 'Nizamabad', 'Telangana', 'Nizamabad', 311152, 18.672, 78.094, false),
  ('Q24932833', 'Dharmaram', 'Telangana', 'Peddapalli', null, 18.736, 79.2194, false),
  ('Q6752062', 'Manthani', 'Telangana', 'Peddapalli', 17927, 18.65, 79.6667, false),
  ('Q7159046', 'Peddapalli', 'Telangana', 'Peddapalli', 41171, 18.6101, 79.3794, false),
  ('Q1780338', 'Ramagundam', 'Telangana', 'Peddapalli', 242979, 18.8, 79.45, false),
  ('Q59066208', 'Vemulawada', 'Telangana', 'Rajanna Sircilla', 33706, 18.4667, 78.8833, false),
  ('Q4854647', 'Bandlaguda Jagir', 'Telangana', 'Ranga Reddy', 12734, 17.3543, 78.3853, false),
  ('Q138714663', 'Cyberabad', 'Telangana', 'Ranga Reddy', null, 17.4415, 78.3826, false),
  ('Q5984843', 'Ibrahimpatnam', 'Telangana', 'Ranga Reddy', 17345, 17.1017, 78.6294, false),
  ('Q6416792', 'Kismatpur', 'Telangana', 'Ranga Reddy', 7288, 17.3333, 78.4, false),
  ('Q6434038', 'Kothur', 'Telangana', 'Ranga Reddy', 10519, 17.1447, 78.2886, false),
  ('Q139596336', 'Malkajgiri', 'Telangana', 'Ranga Reddy', null, 17.4483, 78.5292, false),
  ('Q6193113', 'Meerpet–Jillelguda', 'Telangana', 'Ranga Reddy', null, 17.1958, 78.3131, false),
  ('Q31486069', 'Narsingi, Ranga Reddy district', 'Telangana', 'Ranga Reddy', 9449, 17.3876, 78.357, false),
  ('Q720865', 'Omerkhan Daira', 'Telangana', 'Ranga Reddy', 5349, 17.3753, 78.4744, false),
  ('Q11105829', 'Shamshabad', 'Telangana', 'Ranga Reddy', 32583, 17.2603, 78.3969, false),
  ('Q720922', 'Tandur', 'Telangana', 'Ranga Reddy', 65115, 17.23, 77.58, false),
  ('Q7855026', 'Turkayamjal', 'Telangana', 'Ranga Reddy', 15689, 17.2728, 78.5708, false),
  ('Q55609808', 'Domadugu', 'Telangana', 'Sangareddy', null, 17.6586, 78.3739, false),
  ('Q106464381', 'Kangti', 'Telangana', 'Sangareddy', null, 18.2167, 77.6333, false),
  ('Q13001042', 'Narayankhed', 'Telangana', 'Sangareddy', 15610, 18.0333, 77.7833, false),
  ('Q542856', 'Ramachandrapuram', 'Telangana', 'Sangareddy', 15381, 17.3, 78.17, false),
  ('Q59061593', 'Sangareddy', 'Telangana', 'Sangareddy', 72344, 17.6294, 78.0917, false),
  ('Q12997851', 'Zahirabad', 'Telangana', 'Sangareddy', 71166, 17.68, 77.62, false),
  ('Q59060279', 'Gajwel', 'Telangana', 'Siddipet', 24961, 17.8452, 78.6605, false),
  ('Q3250597', 'Kodad', 'Telangana', 'Suryapet', 64234, 16.9978, 79.9653, false),
  ('Q2573090', 'Suryapet', 'Telangana', 'Suryapet', 106805, 17.15, 79.6167, false),
  ('Q568778', 'Vikarabad', 'Telangana', 'Vikarabad', 53143, 17.33, 77.9, false),
  ('Q4817045', 'Atmakur', 'Telangana', 'Wanaparthy', 12297, 16.3364, 77.8056, false),
  ('Q3424142', 'Kothakota', 'Telangana', 'Wanaparthy', 5749, 16.3667, 77.9667, false),
  ('Q2563513', 'Wanaparthi', 'Telangana', 'Wanaparthy', 60949, 16.361, 78.0627, false),
  ('Q13000630', 'Narsampet', 'Telangana', 'Warangal', 30963, 17.9264, 79.8969, false),
  ('Q25563103', 'Warangal', 'Telangana', 'Warangal', 704570, 17.9756, 79.6011, false),
  ('Q3428143', 'Alair', 'Telangana', 'Yadadri Bhuvanagiri', 18892, 17.65, 79.05, false),
  ('Q797132', 'Bhongir', 'Telangana', 'Yadadri Bhuvanagiri', null, 17.51, 78.89, false),
  ('Q59072363', 'Bibinagar', 'Telangana', 'Yadadri Bhuvanagiri', 8320, 17.4708, 78.7946, false),
  ('Q1190631', 'Choutuppal', 'Telangana', 'Yadadri Bhuvanagiri', 19092, 17.2508, 78.8972, false),
  ('Q3415080', 'Pochampally', 'Telangana', 'Yadadri Bhuvanagiri', null, 17.3861, 78.6433, false),
  ('Q3415103', 'Ramannapeta', 'Telangana', 'Yadadri Bhuvanagiri', 10202, 17.2833, 79.1, false),
  ('Q577793', 'Yadagirigutta', 'Telangana', 'Yadadri Bhuvanagiri', 15232, 17.5864, 78.9461, false),
  ('Q48731532', 'Warangal Tri-City', 'Telangana', null, null, 18.0167, 79.6333, false),
  ('Q589674', 'Amarpur', 'Tripura', 'Gomati', null, 23.53, 91.64, false),
  ('Q2248438', 'Udaipur', 'Tripura', 'Gomati', null, 23.53, 91.48, false),
  ('Q24935664', 'Bishramganj', 'Tripura', 'Sepahijala', null, 23.85, 91.33, false),
  ('Q757844', 'Belonia', 'Tripura', 'South Tripura', null, 23.25, 91.4583, false),
  ('Q2576072', 'Kailashahar', 'Tripura', 'Unakoti', null, 24.33, 92.02, false),
  ('Q170454', 'Agartala', 'Tripura', 'West Tripura', 522613, 23.8333, 91.2667, false),
  ('Q16867235', 'Gandhigram', 'Tripura', null, null, 23.892, 91.2803, false),
  ('Q2182763', 'Lunglei', 'Union Territory of Mizoram', 'Lunglei', null, 22.8866, 92.7451, false),
  ('Q42941', 'Agra', 'Uttar Pradesh', 'Agra', 1585705, 27.18, 78.02, false),
  ('Q1524692', 'Etmadpur', 'Uttar Pradesh', 'Agra', null, 27.2354, 78.1983, false),
  ('Q179046', 'Fatehpur Sikri', 'Uttar Pradesh', 'Agra', 32905, 27.0911, 77.6611, false),
  ('Q108301469', 'Kalwari', 'Uttar Pradesh', 'Agra', null, 27.1781, 77.9389, false),
  ('Q12421872', 'Khandauli', 'Uttar Pradesh', 'Agra', null, 27.3125, 78.0289, false),
  ('Q201832', 'Aligarh', 'Uttar Pradesh', 'Aligarh', 874408, 27.88, 78.08, false),
  ('Q139623231', 'Pisawa', 'Uttar Pradesh', 'Aligarh', null, 27.7782, 77.9455, false),
  ('Q416835', 'Akbarpur', 'Uttar Pradesh', 'Ambedkar Nagar', 42248, 26.52, 82.62, false),
  ('Q584515', 'Amroha', 'Uttar Pradesh', 'Amroha', 198471, 28.9044, 78.4675, false),
  ('Q582043', 'Bachhraon', 'Uttar Pradesh', 'Amroha', null, 28.93, 78.22, false),
  ('Q1257009', 'Dibiyapur', 'Uttar Pradesh', 'Auraiya', null, 26.6358, 79.5567, false),
  ('Q4748786', 'Amsin', 'Uttar Pradesh', 'Ayodhya', null, 26.5733, 82.4357, false),
  ('Q186040', 'Ayodhya', 'Uttar Pradesh', 'Ayodhya', 55890, 26.7992, 82.2044, false),
  ('Q842411', 'Faizabad', 'Uttar Pradesh', 'Ayodhya', 165228, 26.7833, 82.1333, false),
  ('Q23808327', 'Masodha', 'Uttar Pradesh', 'Ayodhya', null, 26.7, 82.1333, false),
  ('Q23808315', 'Rikabganj', 'Uttar Pradesh', 'Ayodhya', null, 26.78, 82.143, false),
  ('Q25247751', 'Sohawal', 'Uttar Pradesh', 'Ayodhya', null, 26.75, 81.9861, false),
  ('Q526757', 'Azamgarh', 'Uttar Pradesh', 'Azamgarh', null, 26.06, 83.19, false),
  ('Q12447218', 'Mubarakpur', 'Uttar Pradesh', 'Azamgarh', null, 26.09, 83.29, false),
  ('Q638621', 'Bahraich', 'Uttar Pradesh', 'Bahraich', 186223, 27.5742, 81.5958, false),
  ('Q20598113', 'Mahasi', 'Uttar Pradesh', 'Bahraich', 546995, 27.6397, 81.3856, false),
  ('Q7380191', 'Rupaidiha', 'Uttar Pradesh', 'Bahraich', null, 28.0218, 81.6021, false),
  ('Q7180187', 'Ballia', 'Uttar Pradesh', 'Ballia', null, 25.7625, 84.1519, false),
  ('Q25662542', 'Phephna', 'Uttar Pradesh', 'Ballia', null, 25.76, 84.04, false),
  ('Q56277988', 'Sohaon', 'Uttar Pradesh', 'Ballia', null, 25.7583, 84.1489, false),
  ('Q612328', 'Balrampur', 'Uttar Pradesh', 'Balrampur', null, 27.4295, 82.1855, false),
  ('Q6161281', 'Jarwa', 'Uttar Pradesh', 'Balrampur', null, 27.65, 82.5167, false),
  ('Q585869', 'Atarra', 'Uttar Pradesh', 'Banda', null, 25.28, 80.57, false),
  ('Q3780142', 'Barabanki', 'Uttar Pradesh', 'Barabanki', null, 26.92, 81.2, false),
  ('Q213026', 'Bareilly', 'Uttar Pradesh', 'Bareilly', 1000000, 28.364, 79.415, false),
  ('Q2717323', 'Shergarh', 'Uttar Pradesh', 'Bareilly', null, 28.6514, 79.3681, false),
  ('Q24949373', 'Chhawani', 'Uttar Pradesh', 'Basti', null, 26.7774, 82.3797, false),
  ('Q796664', 'Bijnor', 'Uttar Pradesh', 'Bijnor', null, 29.37, 78.13, false),
  ('Q1981902', 'Jalalabad', 'Uttar Pradesh', 'Bijnor', null, 29.5972, 78.3153, false),
  ('Q2543489', 'Najibabad', 'Uttar Pradesh', 'Bijnor', null, 29.63, 78.33, false),
  ('Q55641201', 'Nangal Soti', 'Uttar Pradesh', 'Bijnor', null, 29.6614, 78.1887, false),
  ('Q798839', 'Budaun', 'Uttar Pradesh', 'Budaun', null, 28.05, 79.12, false),
  ('Q1654847', 'Gawan', 'Uttar Pradesh', 'Budaun', null, 28.43, 78.35, false),
  ('Q2441627', 'Kachhla', 'Uttar Pradesh', 'Budaun', null, 27.9667, 78.8833, false),
  ('Q2441509', 'Kakrala', 'Uttar Pradesh', 'Budaun', null, 27.8922, 79.1953, false),
  ('Q2717168', 'Ujhani', 'Uttar Pradesh', 'Budaun', null, 28.35, 79.02, false),
  ('Q585153', 'Anupshahr', 'Uttar Pradesh', 'Bulandshahr', null, 28.37, 78.27, false),
  ('Q861248', 'Bulandshahr', 'Uttar Pradesh', 'Bulandshahr', null, 28.4069, 77.8497, false),
  ('Q3418055', 'Khanpur', 'Uttar Pradesh', 'Bulandshahr', null, 28.53, 78.05, false),
  ('Q1525330', 'Etah', 'Uttar Pradesh', 'Etah', 145601, 27.63, 78.67, false),
  ('Q2543304', 'Marehra', 'Uttar Pradesh', 'Etah', 19542, 27.7367, 78.5689, false),
  ('Q137383157', 'Chakar Nagar', 'Uttar Pradesh', 'Etawah', null, 26.5742, 79.0956, false),
  ('Q878237', 'Etawah', 'Uttar Pradesh', 'Etawah', null, 26.77, 79.03, false),
  ('Q4549', 'Farrukhabad', 'Uttar Pradesh', 'Farrukhabad', 291374, 27.3914, 79.5792, false),
  ('Q1452991', 'Firozabad', 'Uttar Pradesh', 'Firozabad', null, 27.15, 78.42, false),
  ('Q2717915', 'Shikohabad', 'Uttar Pradesh', 'Firozabad', null, 27.1, 78.6, false),
  ('Q2717464', 'Sukhmalpur Nizamabad', 'Uttar Pradesh', 'Firozabad', null, 27.1734, 78.4026, false),
  ('Q2717192', 'Tundla', 'Uttar Pradesh', 'Firozabad', null, 27.2146, 78.2368, false),
  ('Q2717493', 'Tundla Kham', 'Uttar Pradesh', 'Firozabad', null, 27.2064, 78.2596, false),
  ('Q1934915', 'Tundla Railway Colony', 'Uttar Pradesh', 'Firozabad', null, 27.2004, 78.2833, false),
  ('Q2711899', 'Greater Noida', 'Uttar Pradesh', 'Gautam Buddh Nagar', 107676, 28.4962, 77.536, false),
  ('Q278204', 'Noida', 'Uttar Pradesh', 'Gautam Buddh Nagar', 637272, 28.57, 77.32, false),
  ('Q207098', 'Ghaziabad', 'Uttar Pradesh', 'Ghaziabad', 2375820, 28.6667, 77.4167, false),
  ('Q2451005', 'Modinagar', 'Uttar Pradesh', 'Ghaziabad', 130325, 28.911, 77.6348, false),
  ('Q1006321', 'Ghazipur', 'Uttar Pradesh', 'Ghazipur', 121020, 25.5833, 83.5667, false),
  ('Q2428556', 'Gonda', 'Uttar Pradesh', 'Gonda', null, 27.1333, 81.9333, false),
  ('Q5584396', 'Gorakhpur', 'Uttar Pradesh', 'Gorakhpur', 673446, 26.7611, 83.3667, false),
  ('Q825673', 'Kushinagar', 'Uttar Pradesh', 'Gorakhpur', 17982, 26.7403, 83.8889, false),
  ('Q3930467', 'Rath', 'Uttar Pradesh', 'Hamirpur', null, 25.58, 79.57, false),
  ('Q795814', 'Bilgram', 'Uttar Pradesh', 'Hardoi', null, 27.18, 80.03, false),
  ('Q1708143', 'Hardoi', 'Uttar Pradesh', 'Hardoi', null, 27.3947, 80.1283, false),
  ('Q19896220', 'Sawayajpur', 'Uttar Pradesh', 'Hardoi', null, 27.4311, 79.8009, false),
  ('Q1709695', 'Hathras', 'Uttar Pradesh', 'Hathras', null, 27.36, 78.03, false),
  ('Q2281643', 'Kalpi', 'Uttar Pradesh', 'Jalaun', null, 26.1167, 79.7333, false),
  ('Q48725427', 'Gaura Census Town', 'Uttar Pradesh', 'Jaunpur', null, 25.7575, 82.8114, false),
  ('Q1025475', 'Jaunpur', 'Uttar Pradesh', 'Jaunpur', 180362, 25.7536, 82.6869, false),
  ('Q2233483', 'Machhlishahr', 'Uttar Pradesh', 'Jaunpur', null, 25.68, 82.42, false),
  ('Q24932167', 'Meerganj, Jaunpur', 'Uttar Pradesh', 'Jaunpur', null, 25.341, 82.2332, false),
  ('Q48725312', 'Sadatmasaura', 'Uttar Pradesh', 'Jaunpur', null, 25.6469, 82.7081, false),
  ('Q627748', 'Baragaon', 'Uttar Pradesh', 'Jhansi', null, 25.4833, 78.7167, false),
  ('Q707790', 'Barua Sagar', 'Uttar Pradesh', 'Jhansi', null, 25.3799, 78.739, false),
  ('Q1707577', 'Gursarai', 'Uttar Pradesh', 'Jhansi', null, 25.62, 79.18, false),
  ('Q242995', 'Jhansi', 'Uttar Pradesh', 'Jhansi', 507000, 25.4486, 78.5696, false),
  ('Q4901840', 'Bhitargaon', 'Uttar Pradesh', 'Kanpur Nagar', null, 26.2106, 80.2761, false),
  ('Q1707190', 'Ghatampur', 'Uttar Pradesh', 'Kanpur Nagar', null, 26.17, 80.17, false),
  ('Q66568', 'Kanpur', 'Uttar Pradesh', 'Kanpur Nagar', 4581268, 26.4725, 80.3311, false),
  ('Q6367451', 'Kara, Uttar Pradesh', 'Uttar Pradesh', 'Kaushambi', null, 25.7, 81.35, false),
  ('Q3783627', 'Hata', 'Uttar Pradesh', 'Kushinagar', null, 26.75, 83.74, false),
  ('Q2341393', 'Padrauna', 'Uttar Pradesh', 'Kushinagar', null, 26.9042, 83.9808, false),
  ('Q5527793', 'Gauriphanta', 'Uttar Pradesh', 'Lakhimpur Kheri', null, 28.6811, 80.5543, false),
  ('Q12424722', 'Gola Gokarannath', 'Uttar Pradesh', 'Lakhimpur Kheri', null, 28.08, 80.47, false),
  ('Q1025286', 'Lalitpur', 'Uttar Pradesh', 'Lalitpur', null, 24.6903, 78.4189, false),
  ('Q48730526', 'Kalli Pashchim', 'Uttar Pradesh', 'Lucknow', null, 26.7167, 80.9, false),
  ('Q47916', 'Lucknow', 'Uttar Pradesh', 'Lucknow', 3382000, 26.847, 80.947, false),
  ('Q2725709', 'Nautanwa', 'Uttar Pradesh', 'Maharajganj', null, 27.43, 83.42, false),
  ('Q7560850', 'Sonauli', 'Uttar Pradesh', 'Maharajganj', null, 27.4738, 83.4691, false),
  ('Q1393339', 'Kulpahar', 'Uttar Pradesh', 'Mahoba', null, 25.319, 79.641, false),
  ('Q1814470', 'Mahoba', 'Uttar Pradesh', 'Mahoba', null, 25.28, 79.8729, false),
  ('Q2287173', 'Mainpuri', 'Uttar Pradesh', 'Mainpuri', null, 27.23, 79.02, false),
  ('Q1522971', 'Farah', 'Uttar Pradesh', 'Mathura', null, 27.33, 77.77, false),
  ('Q1707255', 'Govardhan', 'Uttar Pradesh', 'Mathura', null, 27.4958, 77.4628, false),
  ('Q200311', 'Mathura', 'Uttar Pradesh', 'Mathura', null, 27.4924, 77.6737, false),
  ('Q2037248', 'Radha Kund', 'Uttar Pradesh', 'Mathura', null, 27.5244, 77.4903, false),
  ('Q2717582', 'Sonkh', 'Uttar Pradesh', 'Mathura', null, 27.3956, 77.4944, false),
  ('Q24906778', 'Surir', 'Uttar Pradesh', 'Mathura', null, 27.7718, 77.7208, false),
  ('Q688281', 'Vrindavan', 'Uttar Pradesh', 'Mathura', 56618, 27.5728, 77.6933, false),
  ('Q26266301', 'Ratanpura', 'Uttar Pradesh', 'Mau', null, 25.921, 83.7447, false),
  ('Q459714', 'Hastinapur', 'Uttar Pradesh', 'Meerut', null, 29.2833, 78.0333, false),
  ('Q200237', 'Meerut', 'Uttar Pradesh', 'Meerut', 1571434, 28.98, 77.7064, false),
  ('Q2768828', 'Muzaffarnagar', 'Uttar Pradesh', 'Meerut', 392768, 29.4675, 77.705, false),
  ('Q1192683', 'Chunar', 'Uttar Pradesh', 'Mirzapur', null, 25.13, 82.9, false),
  ('Q330643', 'Moradabad', 'Uttar Pradesh', 'Moradabad', 887871, 28.8432, 78.7287, false),
  ('Q1197824', 'Pilibhit', 'Uttar Pradesh', 'Pilibhit', null, 28.6333, 79.7667, false),
  ('Q2648298', 'Manikpur, Uttar Pradesh', 'Uttar Pradesh', 'Pratapgarh', null, 25.933, 81.983, false),
  ('Q162442', 'Prayagraj', 'Uttar Pradesh', 'Prayagraj', 5954391, 25.45, 81.85, false),
  ('Q3958993', 'Shahabad', 'Uttar Pradesh', 'Rampur', null, 28.5669, 79.0094, false),
  ('Q242895', 'Saharanpur', 'Uttar Pradesh', 'Saharanpur', 705478, 29.964, 77.546, false),
  ('Q632831', 'Bahjoi', 'Uttar Pradesh', 'Sambhal', null, 28.393, 78.623, false),
  ('Q247248', 'Sambhal', 'Uttar Pradesh', 'Sambhal', 220813, 28.5852, 78.5709, false),
  ('Q1748623', 'Maghar', 'Uttar Pradesh', 'Sant Kabir Nagar', null, 26.76, 83.13, false),
  ('Q2016760', 'Parashurampuri', 'Uttar Pradesh', 'Shahjahanpur', null, 27.12, 79.78, false),
  ('Q2450872', 'Kairana', 'Uttar Pradesh', 'Shamli', 89000, 29.4, 77.2, false),
  ('Q2450994', 'Shamli', 'Uttar Pradesh', 'Shamli', null, 29.45, 77.32, false),
  ('Q2231193', 'Thana Bhawan', 'Uttar Pradesh', 'Shamli', null, 29.5833, 77.4167, false),
  ('Q707799', 'Barhani Bazar', 'Uttar Pradesh', 'Siddharthnagar', null, 27.5136, 82.7861, false),
  ('Q6403040', 'Khunwa', 'Uttar Pradesh', 'Siddharthnagar', null, 27.4558, 82.9936, false),
  ('Q858291', 'Biswan', 'Uttar Pradesh', 'Sitapur', null, 27.5, 81.0, false),
  ('Q599786', 'Khairabad', 'Uttar Pradesh', 'Sitapur', null, 27.53, 80.75, false),
  ('Q1925034', 'Mahmudabad', 'Uttar Pradesh', 'Sitapur', null, 27.3, 81.12, false),
  ('Q2717642', 'Sidhauli', 'Uttar Pradesh', 'Sitapur', null, 27.28, 80.83, false),
  ('Q922701', 'Sitapur', 'Uttar Pradesh', 'Sitapur', null, 27.5667, 80.6833, false),
  ('Q1021406', 'Sultanpur', 'Uttar Pradesh', 'Sultanpur', null, 26.2617, 82.0717, false),
  ('Q656717', 'Maurawan', 'Uttar Pradesh', 'Unnao', null, 26.43, 80.88, false),
  ('Q1925021', 'Mohan', 'Uttar Pradesh', 'Unnao', null, 26.78, 80.67, false),
  ('Q939610', 'Unnao', 'Uttar Pradesh', 'Unnao', null, 26.55, 80.48, false),
  ('Q1749044', 'Ramnagar', 'Uttar Pradesh', 'Varanasi', null, 25.2692, 83.0297, false),
  ('Q324394', 'Sarnath', 'Uttar Pradesh', 'Varanasi', null, 25.3811, 83.0214, false),
  ('Q79980', 'Varanasi', 'Uttar Pradesh', 'Varanasi', 1198491, 25.3189, 83.0128, false),
  ('Q23808322', 'Ayodhya Cantt', 'Uttar Pradesh', null, null, 26.7964, 82.1337, false),
  ('Q624402', 'Baghpat', 'Uttar Pradesh', null, null, 28.95, 77.22, false),
  ('Q17157404', 'Bairia', 'Uttar Pradesh', null, null, 25.7583, 84.1489, false),
  ('Q23808323', 'Kumarganj', 'Uttar Pradesh', null, null, 26.553, 81.8425, false),
  ('Q7180664', 'Phaphamau', 'Uttar Pradesh', null, null, 25.5333, 81.8667, false),
  ('Q1487593', 'Rampur', 'Uttar Pradesh', null, null, 28.788, 79.019, false),
  ('Q7492991', 'Sheikhupur, Badaun', 'Uttar Pradesh', null, null, 28.35, 79.02, false),
  ('Q2594448', 'Shravasti', 'Uttar Pradesh', null, null, 27.5171, 82.0506, false),
  ('Q588817', 'Almora', 'Uttarakhand', 'Almora', 34122, 29.62, 79.67, false),
  ('Q109715359', 'Bhararisain', 'Uttarakhand', 'Chamoli', null, 30.0981, 79.2652, false),
  ('Q1026878', 'Joshimath', 'Uttarakhand', 'Chamoli', null, 30.555, 79.565, false),
  ('Q637818', 'Banbasa', 'Uttarakhand', 'Champawat', null, 28.9799, 80.08, false),
  ('Q5210070', 'Dakpathar', 'Uttarakhand', 'Dehradun', null, 30.4969, 77.7989, false),
  ('Q199528', 'Dehradun', 'Uttarakhand', 'Dehradun', 578420, 30.318, 78.029, false),
  ('Q1258676', 'Doiwala', 'Uttarakhand', 'Dehradun', null, 30.176, 78.124, false),
  ('Q502141', 'Rishikesh', 'Uttarakhand', 'Dehradun', 70499, 30.1, 78.3, false),
  ('Q4900683', 'Bhagwanpur', 'Uttarakhand', 'Haridwar', null, 29.9417, 77.8138, false),
  ('Q273030', 'Haridwar', 'Uttarakhand', 'Haridwar', null, 29.9667, 78.1667, false),
  ('Q656164', 'Laksar', 'Uttarakhand', 'Haridwar', null, 29.77, 78.05, false),
  ('Q1020718', 'Roorkee', 'Uttarakhand', 'Haridwar', null, 29.8614, 77.8889, false),
  ('Q795774', 'Bhimtal', 'Uttarakhand', 'Nainital', 7722, 29.3444, 79.5631, false),
  ('Q1707839', 'Haldwani', 'Uttarakhand', 'Nainital', null, 29.2145, 79.5279, false),
  ('Q773213', 'Nainital', 'Uttarakhand', 'Nainital', 41377, 29.3919, 79.4542, false),
  ('Q2669058', 'Ramnagar', 'Uttarakhand', 'Nainital', null, 29.3942, 79.1264, false),
  ('Q2087739', 'Kotdwar', 'Uttarakhand', 'Pauri Garhwal', null, 29.7453, 78.52, false),
  ('Q2548709', 'Srinagar', 'Uttarakhand', 'Pauri Garhwal', null, 30.2231, 78.79, false),
  ('Q684523', 'Dharchula', 'Uttarakhand', 'Pithoragarh', null, 29.8485, 80.543, false),
  ('Q2080817', 'Gangolihat', 'Uttarakhand', 'Pithoragarh', null, 29.6572, 80.0403, false),
  ('Q12429573', 'Jauljibi', 'Uttarakhand', 'Pithoragarh', null, 29.7519, 80.3778, false),
  ('Q15229561', 'Jhulaghat', 'Uttarakhand', 'Pithoragarh', null, 29.571, 80.375, false),
  ('Q1109422', 'Narendra Nagar', 'Uttarakhand', 'Tehri Garhwal', 6049, 30.17, 78.3, false),
  ('Q2249856', 'New Tehri', 'Uttarakhand', 'Tehri Garhwal', null, 30.3833, 78.4833, false),
  ('Q1026180', 'Kashipur', 'Uttarakhand', 'Udham Singh Nagar', null, 29.2136, 78.9558, false),
  ('Q962889', 'Pantnagar', 'Uttarakhand', 'Udham Singh Nagar', null, 29.0222, 79.4875, false),
  ('Q2720109', 'Sitarganj', 'Uttarakhand', 'Udham Singh Nagar', null, 28.93, 79.7, false),
  ('Q27832', 'Devprayag', 'Uttarakhand', null, null, 30.1458, 78.5979, false),
  ('Q108114814', 'Fatehpur Range', 'Uttarakhand', null, null, 29.3036, 79.0592, false),
  ('Q108114535', 'Haldwani Talli', 'Uttarakhand', null, null, 29.1836, 79.4778, false),
  ('Q108124174', 'Maholiya', 'Uttarakhand', null, null, 28.8978, 79.8672, false),
  ('Q108114607', 'Mukhani', 'Uttarakhand', null, null, 29.2108, 79.4992, false),
  ('Q2249870', 'Pithoragarh', 'Uttarakhand', null, 56044, 29.5859, 80.2152, false),
  ('Q2333417', 'Rudrapur', 'Uttarakhand', null, 154485, 28.9708, 79.3972, false),
  ('Q7404269', 'Salempur Rajputana', 'Uttarakhand', null, null, 29.875, 77.858, false),
  ('Q108103451', 'Shafipur', 'Uttarakhand', null, null, 29.8728, 77.8639, false),
  ('Q108103556', 'Sunhaira', 'Uttarakhand', null, null, 29.8903, 77.8306, false),
  ('Q7709674', 'Thalisain', 'Uttarakhand', null, null, 30.02, 79.049, false),
  ('Q108133113', 'Umru Khurd', 'Uttarakhand', null, null, 28.9539, 79.9444, false),
  ('Q548210', 'Alipurduar', 'West Bengal', 'Alipurduar', 65232, 26.5, 89.52, false),
  ('Q583727', 'Alipurduar Railway Junction', 'West Bengal', 'Alipurduar', 10733, 26.5253, 89.5436, false),
  ('Q514246', 'Bholar Dabri', 'West Bengal', 'Alipurduar', 12670, 26.52, 89.56, false),
  ('Q4916936', 'Birpara', 'West Bengal', 'Alipurduar', 10821, 26.5, 89.5, false),
  ('Q886587', 'Chechakhata', 'West Bengal', 'Alipurduar', 7613, 26.54, 89.54, false),
  ('Q1525281', 'Falakata', 'West Bengal', 'Alipurduar', 19716, 26.53, 89.2, false),
  ('Q14217868', 'Hasimara', 'West Bengal', 'Alipurduar', null, 26.75, 89.35, false),
  ('Q97176320', 'Jagijhora Barabak', 'West Bengal', 'Alipurduar', null, 26.6986, 89.0825, false),
  ('Q1026903', 'Jaigaon', 'West Bengal', 'Alipurduar', 42254, 26.83, 89.38, false),
  ('Q729579', 'Paschim Jitpur', 'West Bengal', 'Alipurduar', 14334, 26.556, 89.5349, false),
  ('Q79229317', 'Sishujhumra', 'West Bengal', 'Alipurduar', 4130, 26.7166, 89.0775, false),
  ('Q2733099', 'Sobhaganj', 'West Bengal', 'Alipurduar', 5488, 26.48, 89.54, false),
  ('Q2560670', 'Uttar Kamakhyaguri', 'West Bengal', 'Alipurduar', 12022, 26.48, 89.73, false),
  ('Q2733621', 'Uttar Latabari', 'West Bengal', 'Alipurduar', 16350, 26.68, 89.44, false),
  ('Q97177215', 'Uttar Satali', 'West Bengal', 'Alipurduar', null, 26.7114, 89.3631, false),
  ('Q1949030', 'Bankura', 'West Bengal', 'Bankura', 137386, 23.25, 87.0667, false),
  ('Q712475', 'Barjora', 'West Bengal', 'Bankura', 14012, 23.4333, 87.2833, false),
  ('Q759158', 'Beliatore', 'West Bengal', 'Bankura', 6463, 23.3333, 87.2167, false),
  ('Q533087', 'Bishnupur', 'West Bengal', 'Bankura', 67783, 23.0739, 87.32, false),
  ('Q61974499', 'Jhantipahari', 'West Bengal', 'Bankura', 5326, 23.3697, 86.9027, false),
  ('Q6400935', 'Khatra', 'West Bengal', 'Bankura', 7382, 22.98, 86.85, false),
  ('Q28164125', 'Kotulpur', 'West Bengal', 'Bankura', 8483, 23.0125, 87.5936, false),
  ('Q96387167', 'Ledisol', 'West Bengal', 'Bankura', null, 22.9816, 86.8634, false),
  ('Q28164115', 'Raipur', 'West Bengal', 'Bankura', 6280, 22.8, 86.95, false),
  ('Q28164119', 'Simlapal', 'West Bengal', 'Bankura', 7206, 22.9227, 87.0734, false),
  ('Q2560660', 'Sonamukhi', 'West Bengal', 'Bankura', 29085, 23.3, 87.42, false),
  ('Q584907', 'Ahmedpur', 'West Bengal', 'Birbhum', 9242, 23.8301, 87.6866, false),
  ('Q79482001', 'Ambhua', 'West Bengal', 'Birbhum', 10477, 24.5568, 87.8651, false),
  ('Q79481997', 'Barua Gopalpur', 'West Bengal', 'Birbhum', 6614, 24.5618, 87.8121, false),
  ('Q858304', 'Bolpur', 'West Bengal', 'Birbhum', 80210, 23.6621, 87.6973, false),
  ('Q656516', 'Dubrajpur', 'West Bengal', 'Birbhum', 38041, 23.8, 87.38, false),
  ('Q79482014', 'Fatehpur', 'West Bengal', 'Birbhum', 10176, 24.0846, 87.7302, false),
  ('Q5996988', 'Ilambazar', 'West Bengal', 'Birbhum', 7125, 23.63, 87.53, false),
  ('Q79482018', 'Kalipur', 'West Bengal', 'Birbhum', 4770, 23.9048, 87.5078, false),
  ('Q48734629', 'Karidhya', 'West Bengal', 'Birbhum', 10466, 23.9128, 87.4939, false),
  ('Q79482006', 'Kashimnagar', 'West Bengal', 'Birbhum', 9796, 24.4458, 87.9251, false),
  ('Q6467020', 'Labhpur', 'West Bengal', 'Birbhum', 5419, 23.83, 87.82, false),
  ('Q6896358', 'Mallarpur', 'West Bengal', 'Birbhum', 6471, 24.0814, 87.7093, false),
  ('Q48723806', 'Murarai', 'West Bengal', 'Birbhum', 5770, 24.4428, 87.8575, false),
  ('Q6960882', 'Nalhati', 'West Bengal', 'Birbhum', 41534, 24.3, 87.82, false),
  ('Q79482024', 'Parota', 'West Bengal', 'Birbhum', 5267, 23.779, 87.8726, false),
  ('Q7286324', 'Rajnagar', 'West Bengal', 'Birbhum', 13965, 23.95, 87.32, false),
  ('Q2120473', 'Rampurhat', 'West Bengal', 'Birbhum', 57833, 24.17, 87.78, false),
  ('Q740450', 'Sainthia', 'West Bengal', 'Birbhum', 44601, 23.95, 87.67, false),
  ('Q2667851', 'Suri', 'West Bengal', 'Birbhum', 67864, 23.9167, 87.5333, false),
  ('Q13060084', 'Surul', 'West Bengal', 'Birbhum', 12160, 23.6639, 87.665, false),
  ('Q16253071', 'Bamanhat', 'West Bengal', 'Cooch Behar', null, 26.0706, 89.5862, false),
  ('Q4854849', 'Baneswar', 'West Bengal', 'Cooch Behar', 4841, 26.3944, 89.4958, false),
  ('Q371426', 'Bhangri Pratham Khanda', 'West Bengal', 'Cooch Behar', 4379, 26.11, 89.47, false),
  ('Q313640', 'Cooch Behar', 'West Bengal', 'Cooch Behar', 77935, 26.3167, 89.4333, false),
  ('Q79394297', 'Dhaliabari', 'West Bengal', 'Cooch Behar', 4383, 26.2797, 89.4672, false),
  ('Q1264946', 'Dinhata', 'West Bengal', 'Cooch Behar', 36124, 26.13, 89.47, false),
  ('Q1706407', 'Guriahati', 'West Bengal', 'Cooch Behar', 21064, 26.3096, 89.4866, false),
  ('Q919568', 'Haldibari', 'West Bengal', 'Cooch Behar', 14404, 26.33, 88.77, false),
  ('Q2120431', 'Khagrabari', 'West Bengal', 'Cooch Behar', 23122, 26.36, 89.46, false),
  ('Q2120134', 'Kharimala Khagrabari', 'West Bengal', 'Cooch Behar', 7844, 26.3248, 89.4848, false),
  ('Q2453407', 'Mathabhanga', 'West Bengal', 'Cooch Behar', 23890, 26.342, 89.2155, false),
  ('Q2563945', 'Mekhliganj', 'West Bengal', 'Cooch Behar', 9127, 26.35, 88.92, false),
  ('Q64348086', 'Nagar Changrabandha', 'West Bengal', 'Cooch Behar', 4483, 26.4131, 88.9193, false),
  ('Q2560618', 'Tufanganj', 'West Bengal', 'Cooch Behar', 20998, 26.32, 89.67, false),
  ('Q633291', 'Balurghat', 'West Bengal', 'Dakshin Dinajpur', 153279, 25.2167, 88.7667, false),
  ('Q38249526', 'Buniadpur', 'West Bengal', 'Dakshin Dinajpur', 4424, 25.3862, 88.3968, false),
  ('Q60772421', 'Chak Bhrigu', 'West Bengal', 'Dakshin Dinajpur', 6269, 25.2286, 88.7672, false),
  ('Q60772406', 'Dakra', 'West Bengal', 'Dakshin Dinajpur', 5268, 25.2388, 88.7699, false),
  ('Q1656762', 'Gangarampur', 'West Bengal', 'Dakshin Dinajpur', 56217, 25.4, 88.52, false),
  ('Q60739833', 'Harirampur', 'West Bengal', 'Dakshin Dinajpur', 5021, 25.3786, 88.2677, false),
  ('Q60772377', 'Par Patiram', 'West Bengal', 'Dakshin Dinajpur', 3225, 25.3346, 88.7569, false),
  ('Q61930129', 'Badamtam Tea Garden', 'West Bengal', 'Darjeeling', 6102, 27.0994, 88.2997, false),
  ('Q638719', 'Bairatisal', 'West Bengal', 'Darjeeling', 4916, 26.7034, 88.3471, false),
  ('Q61930150', 'Bara Mohansingh', 'West Bengal', 'Darjeeling', 15616, 26.7044, 88.3651, false),
  ('Q61930155', 'Bhimram', 'West Bengal', 'Darjeeling', 11058, 26.6731, 88.1996, false),
  ('Q858410', 'Cart Road', 'West Bengal', 'Darjeeling', 14444, 26.94, 88.31, false),
  ('Q61930133', 'Chongtong Tea Garden', 'West Bengal', 'Darjeeling', 5802, 27.0595, 88.1956, false),
  ('Q169997', 'Darjeeling', 'West Bengal', 'Darjeeling', 118805, 27.0375, 88.2631, false),
  ('Q61930131', 'Ging Tea Garden', 'West Bengal', 'Darjeeling', 4089, 27.0737, 88.3018, false),
  ('Q61930142', 'Kalkut', 'West Bengal', 'Darjeeling', 9184, 26.7585, 88.4183, false),
  ('Q61930164', 'Kharibari', 'West Bengal', 'Darjeeling', 6660, 26.5539, 88.1855, false),
  ('Q1025634', 'Kurseong', 'West Bengal', 'Darjeeling', 42446, 26.88, 88.28, false),
  ('Q61930141', 'Mangarjung Tea Garden', 'West Bengal', 'Darjeeling', 5644, 26.923, 88.1857, false),
  ('Q2733296', 'Mirik', 'West Bengal', 'Darjeeling', 11513, 26.887, 88.187, false),
  ('Q61930138', 'Rongmook Ceder Tea Garden', 'West Bengal', 'Darjeeling', 5150, 26.9491, 88.2381, false),
  ('Q61930160', 'Shyamdhan', 'West Bengal', 'Darjeeling', 5192, 26.6007, 88.167, false),
  ('Q5087', 'Siliguri', 'West Bengal', 'Darjeeling', 294546, 26.72, 88.42, false),
  ('Q61930135', 'Singtam Tea Garden', 'West Bengal', 'Darjeeling', 5792, 27.0522, 88.2231, false),
  ('Q7560731', 'Sonada', 'West Bengal', 'Darjeeling', 11635, 26.962, 88.2684, false),
  ('Q7635805', 'Sukhiapokhri', 'West Bengal', 'Darjeeling', 4450, 27.0, 88.14, false),
  ('Q2733636', 'Uttar Bagdogra', 'West Bengal', 'Darjeeling', 25044, 26.69, 88.31, false),
  ('Q60745549', 'Alikhoja', 'West Bengal', 'Hooghly', 4613, 22.9784, 88.3707, false),
  ('Q590017', 'Amodghata', 'West Bengal', 'Hooghly', 7910, 22.99, 88.39, false),
  ('Q582917', 'Arambagh', 'West Bengal', 'Hooghly', 66175, 22.88, 87.78, false),
  ('Q583138', 'Badhagachhi', 'West Bengal', 'Hooghly', 5052, 23.1987, 88.4089, false),
  ('Q625394', 'Baidyabati', 'West Bengal', 'Hooghly', 121110, 22.79, 88.32, false),
  ('Q24949896', 'Baksa', 'West Bengal', 'Hooghly', 6432, 22.7237, 88.2407, false),
  ('Q60745774', 'Balarambati', 'West Bengal', 'Hooghly', 5068, 22.8215, 88.2174, false),
  ('Q2453493', 'Bamunari', 'West Bengal', 'Hooghly', 6266, 22.6745, 88.3165, false),
  ('Q629006', 'Bandel', 'West Bengal', 'Hooghly', 272302, 22.9228, 88.3794, false),
  ('Q622607', 'Bansberia', 'West Bengal', 'Hooghly', 103920, 22.97, 88.4, false),
  ('Q60745775', 'Bargachhia', 'West Bengal', 'Hooghly', 4566, 22.8333, 88.1787, false),
  ('Q708569', 'Barijhati', 'West Bengal', 'Hooghly', 7136, 22.6862, 88.2645, false),
  ('Q24946787', 'Baruipara', 'West Bengal', 'Hooghly', 6731, 22.7574, 88.2429, false),
  ('Q60746353', 'Basai', 'West Bengal', 'Hooghly', 8772, 22.7035, 88.3111, false),
  ('Q25247750', 'Batika', 'West Bengal', 'Hooghly', 8717, 23.1209, 88.2013, false),
  ('Q757843', 'Begampur', 'West Bengal', 'Hooghly', 10487, 22.74, 88.24, false),
  ('Q60746297', 'Belumilki', 'West Bengal', 'Hooghly', 10998, 22.751, 88.293, false),
  ('Q2453308', 'Bhadreswar', 'West Bengal', 'Hooghly', 101477, 22.82, 88.35, false),
  ('Q24949531', 'Bhagabatipur', 'West Bengal', 'Hooghly', 7068, 22.6938, 88.1936, false),
  ('Q19882410', 'Boinchi', 'West Bengal', 'Hooghly', null, 23.1191, 88.1941, false),
  ('Q60745794', 'Borai', 'West Bengal', 'Hooghly', 6522, 22.7715, 88.2524, false),
  ('Q858395', 'Chak Bansberia', 'West Bengal', 'Hooghly', 10357, 22.97, 88.37, false),
  ('Q857746', 'Champdani', 'West Bengal', 'Hooghly', 111251, 22.8, 88.37, false),
  ('Q695591', 'Chandannagar', 'West Bengal', 'Hooghly', 166867, 22.8671, 88.3674, false),
  ('Q1103985', 'Chikrand', 'West Bengal', 'Hooghly', 10375, 22.72, 88.27, false),
  ('Q1191581', 'Dakshin Rajyadharpur', 'West Bengal', 'Hooghly', 11254, 22.76, 88.32, false),
  ('Q5219966', 'Dankuni', 'West Bengal', 'Hooghly', 94936, 22.6854, 88.2922, false),
  ('Q2738764', 'Dharmapur', 'West Bengal', 'Hooghly', 8456, 22.88, 88.39, false),
  ('Q24949629', 'Dudhkalmi', 'West Bengal', 'Hooghly', 5558, 22.7183, 88.1992, false),
  ('Q19891544', 'Gangadharpur', 'West Bengal', 'Hooghly', 7862, 22.7604, 88.2218, false),
  ('Q1653485', 'Garalgachha', 'West Bengal', 'Hooghly', 5411, 22.68, 88.27, false),
  ('Q60745543', 'Hansghara', 'West Bengal', 'Hooghly', 7665, 23.0, 88.373, false),
  ('Q20099772', 'Hugli-Chuchura', 'West Bengal', 'Hooghly', 179931, 22.9089, 88.3967, false),
  ('Q24949075', 'Jagatnagar', 'West Bengal', 'Hooghly', 5242, 22.784, 88.2213, false),
  ('Q24949889', 'Janai', 'West Bengal', 'Hooghly', 12837, 22.7157, 88.2426, false),
  ('Q24949057', 'Jangalpara', 'West Bengal', 'Hooghly', 7478, 22.7318, 88.2068, false),
  ('Q24949899', 'Jaykrishnapur', 'West Bengal', 'Hooghly', 5180, 22.744, 88.2624, false),
  ('Q6202992', 'Jirat', 'West Bengal', 'Hooghly', 7430, 23.0983, 88.4617, false),
  ('Q2453263', 'Kanaipur', 'West Bengal', 'Hooghly', 26814, 22.6895, 88.3311, false),
  ('Q24949903', 'Kapashanria', 'West Bengal', 'Hooghly', 5148, 22.7558, 88.2669, false),
  ('Q24898578', 'Keota', 'West Bengal', 'Hooghly', 18875, 22.9264, 88.3953, false),
  ('Q2120400', 'Kharsarai', 'West Bengal', 'Hooghly', 6247, 22.7449, 88.2475, false),
  ('Q2233426', 'Kodalia', 'West Bengal', 'Hooghly', 8994, 22.9072, 88.38, false),
  ('Q60745530', 'Kola', 'West Bengal', 'Hooghly', 7271, 22.9913, 88.365, false),
  ('Q2235942', 'Konnagar', 'West Bengal', 'Hooghly', 76172, 22.7, 88.35, false),
  ('Q2238877', 'Kulihanda', 'West Bengal', 'Hooghly', 15969, 22.8955, 88.3752, false),
  ('Q24949522', 'Kumirmora', 'West Bengal', 'Hooghly', 12208, 22.6939, 88.2192, false),
  ('Q2244101', 'Madhusudanpur', 'West Bengal', 'Hooghly', 6685, 23.01, 88.4, false),
  ('Q25247967', 'Manirampur', 'West Bengal', 'Hooghly', 7428, 22.7457, 88.2289, false),
  ('Q60745554', 'Manushpur', 'West Bengal', 'Hooghly', 8148, 22.9314, 88.3743, false),
  ('Q24946746', 'Masat', 'West Bengal', 'Hooghly', 8007, 22.737, 88.1918, false),
  ('Q60745467', 'Mirdhanga', 'West Bengal', 'Hooghly', 8482, 23.1902, 88.4149, false),
  ('Q24949520', 'Nababpur', 'West Bengal', 'Hooghly', 12728, 22.7073, 88.1998, false),
  ('Q2564083', 'Nabagram Colony', 'West Bengal', 'Hooghly', 18358, 22.29, 88.51, false),
  ('Q25206295', 'Naiti', 'West Bengal', 'Hooghly', 6996, 22.7028, 88.2699, false),
  ('Q24898306', 'Naldanga', 'West Bengal', 'Hooghly', 13140, 22.9202, 88.37, false),
  ('Q60745407', 'Namajgram', 'West Bengal', 'Hooghly', 7252, 23.0702, 88.2664, false),
  ('Q60745790', 'Nasibpur', 'West Bengal', 'Hooghly', 7517, 22.8095, 88.2644, false),
  ('Q60740001', 'Nawapara', 'West Bengal', 'Hooghly', 7262, 22.7091, 88.3274, false),
  ('Q2733665', 'Pairagachha', 'West Bengal', 'Hooghly', 4703, 22.7, 88.27, false),
  ('Q24949900', 'Panchghara', 'West Bengal', 'Hooghly', 8428, 22.7356, 88.2675, false),
  ('Q2227534', 'Pandua', 'West Bengal', 'Hooghly', 30700, 23.08, 88.28, false),
  ('Q2733435', 'Purba Tajpur', 'West Bengal', 'Hooghly', 7035, 22.7441, 88.2572, false),
  ('Q60745382', 'Purusottampur', 'West Bengal', 'Hooghly', 3665, 23.0792, 88.2634, false),
  ('Q7285892', 'Rajbalhat', 'West Bengal', 'Hooghly', 16479, 22.76, 88.04, false),
  ('Q24949627', 'Ramanathpur', 'West Bengal', 'Hooghly', 6811, 22.6891, 88.2191, false),
  ('Q2453443', 'Rishra', 'West Bengal', 'Hooghly', 124577, 22.71, 88.35, false),
  ('Q1815367', 'Serampore', 'West Bengal', 'Hooghly', 181842, 22.75, 88.34, false),
  ('Q2733627', 'Shankhanagar', 'West Bengal', 'Hooghly', 8601, 22.97, 88.38, false),
  ('Q3961069', 'Simla', 'West Bengal', 'Hooghly', 15988, 22.74, 88.32, false),
  ('Q2718731', 'Singur', 'West Bengal', 'Hooghly', 21382, 22.81, 88.23, false),
  ('Q60745471', 'Sripur', 'West Bengal', 'Hooghly', 7224, 23.1178, 88.4673, false),
  ('Q2453287', 'Tarakeswar', 'West Bengal', 'Hooghly', 30947, 22.89, 88.02, false),
  ('Q24949902', 'Tisa', 'West Bengal', 'Hooghly', 4882, 22.754, 88.2526, false),
  ('Q2317215', 'Uttarpara Kotrung', 'West Bengal', 'Hooghly', 159147, 22.67, 88.35, false),
  ('Q25247439', 'Amta', 'West Bengal', 'Howrah', 16699, 22.5733, 88.0161, false),
  ('Q582251', 'Andul', 'West Bengal', 'Howrah', 6302, 22.58, 88.24, false),
  ('Q589725', 'Ankurhati', 'West Bengal', 'Howrah', 11130, 22.6, 88.24, false),
  ('Q583778', 'Argari', 'West Bengal', 'Howrah', 10715, 22.58, 88.22, false),
  ('Q627013', 'Bagnan', 'West Bengal', 'Howrah', 10996, 22.4675, 87.9653, false),
  ('Q637712', 'Balarampota', 'West Bengal', 'Howrah', 5544, 22.5115, 88.1472, false),
  ('Q601897', 'Bally', 'West Bengal', 'Howrah', 293373, 22.65, 88.34, false),
  ('Q637079', 'Bankra', 'West Bengal', 'Howrah', 63957, 22.63, 88.3, false),
  ('Q638692', 'Banupur', 'West Bengal', 'Howrah', 9626, 22.5671, 88.2539, false),
  ('Q24952512', 'Barunda', 'West Bengal', 'Howrah', 7534, 22.4558, 87.92, false),
  ('Q2453434', 'Beldubi', 'West Bengal', 'Howrah', 10871, 22.54, 88.17, false),
  ('Q759149', 'Bhandardaha', 'West Bengal', 'Howrah', 5667, 22.62, 88.21, false),
  ('Q796518', 'Bikihakola', 'West Bengal', 'Howrah', 14540, 22.55, 88.15, false),
  ('Q861338', 'Bipra Noapara', 'West Bengal', 'Howrah', 9408, 22.6, 88.22, false),
  ('Q857735', 'Chakapara', 'West Bengal', 'Howrah', 35282, 22.63, 88.35, false),
  ('Q735847', 'Chamrail', 'West Bengal', 'Howrah', 11923, 22.63, 88.3, false),
  ('Q426149', 'Dakshin Jhapardaha', 'West Bengal', 'Howrah', 13704, 22.63, 88.2, false),
  ('Q376767', 'Dhuilya', 'West Bengal', 'Howrah', 20962, 22.57, 88.24, false),
  ('Q26792208', 'Dhulagari', 'West Bengal', 'Howrah', 23740, 22.5822, 88.1711, false),
  ('Q677375', 'Domjur', 'West Bengal', 'Howrah', 18433, 22.64, 88.22, false),
  ('Q1523126', 'Eksara', 'West Bengal', 'Howrah', 7500, 22.63, 88.29, false),
  ('Q1523091', 'Gabberia', 'West Bengal', 'Howrah', 5823, 22.55, 88.13, false),
  ('Q1706857', 'Hatgachha', 'West Bengal', 'Howrah', 5980, 22.42, 88.05, false),
  ('Q2016813', 'Jagadishpur', 'West Bengal', 'Howrah', 16259, 22.65, 88.29, false),
  ('Q25247438', 'Jagatballavpur', 'West Bengal', 'Howrah', 7113, 22.6864, 88.1069, false),
  ('Q2007976', 'Jala Kendua', 'West Bengal', 'Howrah', 6658, 22.55, 88.18, false),
  ('Q2564321', 'Jhorhat', 'West Bengal', 'Howrah', 16940, 22.57, 88.24, false),
  ('Q2564946', 'Kalara', 'West Bengal', 'Howrah', 27210, 22.59, 88.19, false),
  ('Q2466012', 'Kantlia', 'West Bengal', 'Howrah', 9567, 22.61, 88.25, false),
  ('Q2733584', 'Keshabpur', 'West Bengal', 'Howrah', 12073, 22.97, 88.26, false),
  ('Q2119967', 'Khalia', 'West Bengal', 'Howrah', 6265, 22.6181, 88.2926, false),
  ('Q2135459', 'Khalor', 'West Bengal', 'Howrah', 9636, 22.4581, 87.9742, false),
  ('Q2120497', 'Khantora', 'West Bengal', 'Howrah', 6547, 22.6203, 88.2092, false),
  ('Q2563988', 'Mahiari', 'West Bengal', 'Howrah', 18223, 22.59, 88.24, false),
  ('Q2563969', 'Makardaha', 'West Bengal', 'Howrah', 8713, 22.62, 88.24, false),
  ('Q2247212', 'Manikpur', 'West Bengal', 'Howrah', 19804, 22.47, 88.03, false),
  ('Q2563926', 'Mansinhapur', 'West Bengal', 'Howrah', 6004, 22.65, 88.15, false),
  ('Q26792209', 'Masila', 'West Bengal', 'Howrah', 12239, 22.5808, 88.2328, false),
  ('Q2453396', 'Nalpur', 'West Bengal', 'Howrah', 6911, 22.53, 88.19, false),
  ('Q2733460', 'Natibpur', 'West Bengal', 'Howrah', 7212, 22.6017, 88.1842, false),
  ('Q2738427', 'Naupala', 'West Bengal', 'Howrah', 7856, 22.4423, 87.9022, false),
  ('Q2564032', 'Nibra', 'West Bengal', 'Howrah', 27818, 22.61, 88.25, false),
  ('Q2733443', 'Panchla', 'West Bengal', 'Howrah', 26432, 22.54, 88.14, false),
  ('Q2733716', 'Panchpara', 'West Bengal', 'Howrah', 19283, 22.5663, 88.2605, false),
  ('Q2733439', 'Paniara', 'West Bengal', 'Howrah', 7787, 22.5513, 88.1644, false),
  ('Q2228539', 'Podara', 'West Bengal', 'Howrah', 21589, 22.5596, 88.2714, false),
  ('Q593506', 'Raghudebbati', 'West Bengal', 'Howrah', 14165, 22.53, 88.2, false),
  ('Q2733129', 'Ramchandrapur', 'West Bengal', 'Howrah', 10312, 22.9, 88.48, false),
  ('Q2733967', 'Sahapur', 'West Bengal', 'Howrah', 9022, 22.52, 88.17, false),
  ('Q2733982', 'Salap', 'West Bengal', 'Howrah', 15171, 22.61, 88.27, false),
  ('Q2563979', 'Sankrail', 'West Bengal', 'Howrah', 29114, 22.57, 88.24, false),
  ('Q1321117', 'Santoshpur', 'West Bengal', 'Howrah', 7695, 22.5, 88.17, false),
  ('Q2560685', 'Sarenga', 'West Bengal', 'Howrah', 25200, 22.54, 88.21, false),
  ('Q2733136', 'Tentulkuli', 'West Bengal', 'Howrah', 7203, 22.62, 88.27, false),
  ('Q2318927', 'Uluberia', 'West Bengal', 'Howrah', 235345, 22.47, 88.11, false),
  ('Q2733632', 'Uttar Pirpur', 'West Bengal', 'Howrah', 5868, 22.49, 88.1, false),
  ('Q636574', 'Banarhat Tea Garden', 'West Bengal', 'Jalpaiguri', 15652, 26.7881, 89.0408, false),
  ('Q4914428', 'Binnaguri', 'West Bengal', 'Jalpaiguri', 58840, 26.46, 89.2, false),
  ('Q3420495', 'Chalsa Mahabari', 'West Bengal', 'Jalpaiguri', 4973, 26.88, 88.78, false),
  ('Q5207471', 'Dabgram', 'West Bengal', 'Jalpaiguri', 119040, 26.6961, 88.4571, false),
  ('Q1259697', 'Dhupguri', 'West Bengal', 'Jalpaiguri', 44719, 26.6, 89.02, false),
  ('Q1525244', 'Gairkata', 'West Bengal', 'Jalpaiguri', 7577, 26.68, 89.03, false),
  ('Q1949125', 'Jalpaiguri', 'West Bengal', 'Jalpaiguri', 107341, 26.5167, 88.7333, false),
  ('Q15241808', 'Lataguri', 'West Bengal', 'Jalpaiguri', 4981, 26.7063, 88.7661, false),
  ('Q1924989', 'Malbazar', 'West Bengal', 'Jalpaiguri', 25218, 26.85, 88.75, false),
  ('Q587516', 'Maynaguri', 'West Bengal', 'Jalpaiguri', 30490, 26.57, 88.82, false),
  ('Q26780991', 'Odlabari', 'West Bengal', 'Jalpaiguri', 14194, 26.8364, 88.6294, false),
  ('Q7188310', 'Phulbari', 'West Bengal', 'Jalpaiguri', null, 26.6363, 88.4166, false),
  ('Q2287060', 'Jhargram', 'West Bengal', 'Jhargram', 61712, 22.45, 86.98, false),
  ('Q96376737', 'Dungra, Kalimpong', 'West Bengal', 'Kalimpong', null, 27.0702, 88.4864, false),
  ('Q500877', 'Kalimpong', 'West Bengal', 'Kalimpong', 49403, 27.06, 88.47, false),
  ('Q1348', 'Kolkata', 'West Bengal', 'Kolkata', 4496694, 22.5675, 88.37, true),
  ('Q585721', 'Aiho', 'West Bengal', 'Malda', 5898, 24.96, 88.24, false),
  ('Q30591665', 'Alipur', 'West Bengal', 'Malda', 17347, 24.854, 88.0309, false),
  ('Q75706371', 'Bagbari', 'West Bengal', 'Malda', 8660, 25.0151, 88.1168, false),
  ('Q5070845', 'Chanchal', 'West Bengal', 'Malda', 5570, 25.39, 87.99, false),
  ('Q602165', 'Kachu Pukur', 'West Bengal', 'Malda', 5752, 25.0, 88.27, false),
  ('Q2733346', 'Kendua', 'West Bengal', 'Malda', 6452, 24.9832, 88.2475, false),
  ('Q30592839', 'Krishnapur', 'West Bengal', 'Malda', 16470, 24.7929, 87.9947, false),
  ('Q60441500', 'Mahadipur', 'West Bengal', 'Malda', 8638, 24.8566, 88.1248, false),
  ('Q1525057', 'Malda', 'West Bengal', 'Malda', 205521, 25.0044, 88.1458, false),
  ('Q59504934', 'Milki', 'West Bengal', 'Malda', 12581, 25.0186, 87.9999, false),
  ('Q2564010', 'Old Malda', 'West Bengal', 'Malda', 84012, 25.04, 88.14, false),
  ('Q60444051', 'Singabad', 'West Bengal', 'Malda', 1951, 24.9183, 88.2898, false),
  ('Q75422942', 'Ajodhya Nagar', 'West Bengal', 'Murshidabad', 8883, 24.079, 88.2434, false),
  ('Q48725463', 'Amtala, Murshidabad', 'West Bengal', 'Murshidabad', null, 23.9322, 88.4476, false),
  ('Q583685', 'Anup Nagar', 'West Bengal', 'Murshidabad', 12940, 24.6848, 87.9667, false),
  ('Q107473252', 'Arjunpur', 'West Bengal', 'Murshidabad', null, 24.7226, 87.9343, false),
  ('Q1924611', 'Aurangabad', 'West Bengal', 'Murshidabad', 39261, 24.61, 88.06, false),
  ('Q140528419', 'Azimganj', 'West Bengal', 'Murshidabad', null, 24.2278, 88.2569, false),
  ('Q75422927', 'Banjetia', 'West Bengal', 'Murshidabad', 10400, 24.1025, 88.2864, false),
  ('Q75422918', 'Bara Jumla', 'West Bengal', 'Murshidabad', 11074, 24.4384, 88.1756, false),
  ('Q107473294', 'Basudebpur', 'West Bengal', 'Murshidabad', null, 24.6341, 87.9817, false),
  ('Q2341938', 'Beldanga', 'West Bengal', 'Murshidabad', 29205, 23.93, 88.25, false),
  ('Q75422756', 'Benia Gram', 'West Bengal', 'Murshidabad', 15046, 24.776, 87.9253, false),
  ('Q633530', 'Berhampore', 'West Bengal', 'Murshidabad', 195223, 24.1, 88.25, false),
  ('Q861983', 'Chachanda', 'West Bengal', 'Murshidabad', 14244, 24.64, 88.0, false),
  ('Q75422948', 'Chaltia', 'West Bengal', 'Murshidabad', 25336, 24.069, 88.2628, false),
  ('Q3666307', 'Charka', 'West Bengal', 'Murshidabad', 8451, 24.45, 88.09, false),
  ('Q675531', 'Cossimbazar', 'West Bengal', 'Murshidabad', 11724, 24.12, 88.28, false),
  ('Q1193506', 'Dafahat', 'West Bengal', 'Murshidabad', 15688, 24.63, 88.02, false),
  ('Q75422873', 'Dafarpur', 'West Bengal', 'Murshidabad', 16587, 24.446, 88.1025, false),
  ('Q1265617', 'Dhulian', 'West Bengal', 'Murshidabad', 95706, 24.68, 87.97, false),
  ('Q1264673', 'Dhusaripara', 'West Bengal', 'Murshidabad', 17800, 24.64, 88.02, false),
  ('Q60436740', 'Domkal', 'West Bengal', 'Murshidabad', 3914, 24.1217, 88.5406, false),
  ('Q75422900', 'Donalia', 'West Bengal', 'Murshidabad', 6081, 24.4587, 88.1229, false),
  ('Q1525528', 'Farakka Barrage Township', 'West Bengal', 'Murshidabad', 20126, 24.82, 87.9, false),
  ('Q1525252', 'Fatellapur', 'West Bengal', 'Murshidabad', 7207, 24.54, 88.1, false),
  ('Q1706944', 'Ghorsala', 'West Bengal', 'Murshidabad', 7837, 24.4672, 88.0368, false),
  ('Q5564250', 'Giria', 'West Bengal', 'Murshidabad', 17131, 24.5167, 88.0667, false),
  ('Q1708699', 'Goaljan', 'West Bengal', 'Murshidabad', 4850, 24.1048, 88.2292, false),
  ('Q75422937', 'Gopjan', 'West Bengal', 'Murshidabad', 23415, 24.1248, 88.2322, false),
  ('Q1707299', 'Gora Bazar', 'West Bengal', 'Murshidabad', 5200, 24.0683, 88.2651, false),
  ('Q1707200', 'Harharia Chak', 'West Bengal', 'Murshidabad', 9411, 24.1448, 88.4931, false),
  ('Q2008004', 'Jagtaj', 'West Bengal', 'Murshidabad', 11261, 24.63, 88.04, false),
  ('Q2576052', 'Jangipur', 'West Bengal', 'Murshidabad', 88165, 24.4561, 88.1072, false),
  ('Q140528411', 'Jiaganj', 'West Bengal', 'Murshidabad', null, 24.245, 88.2683, false),
  ('Q2330608', 'Jiaganj Azimganj', 'West Bengal', 'Murshidabad', 51790, 24.23, 88.27, false),
  ('Q2453451', 'Jot Kamal', 'West Bengal', 'Murshidabad', 7685, 24.46, 88.1, false),
  ('Q1464395', 'Kandi', 'West Bengal', 'Murshidabad', 55632, 23.95, 88.03, false),
  ('Q2317227', 'Kankuria', 'West Bengal', 'Murshidabad', 36925, 24.658, 87.9794, false),
  ('Q2244809', 'Khodarampur', 'West Bengal', 'Murshidabad', 7277, 24.4808, 88.1271, false),
  ('Q24943059', 'Madna', 'West Bengal', 'Murshidabad', 6312, 24.569, 88.037, false),
  ('Q1017175', 'Murshidabad', 'West Bengal', 'Murshidabad', 44019, 24.18, 88.27, false),
  ('Q24943053', 'Nayabahadurpur', 'West Bengal', 'Murshidabad', 9239, 24.55, 88.063, false),
  ('Q28419557', 'Panchanantala', 'West Bengal', 'Murshidabad', null, 24.0961, 88.2658, false),
  ('Q2227344', 'Paschim Punropara', 'West Bengal', 'Murshidabad', 40683, 24.6301, 88.0492, false),
  ('Q48723774', 'Raghunathganj', 'West Bengal', 'Murshidabad', null, 24.468, 88.054, false),
  ('Q24943067', 'Ramakantapur', 'West Bengal', 'Murshidabad', 6347, 24.554, 88.055, false),
  ('Q2733464', 'Sahajadpur', 'West Bengal', 'Murshidabad', 23280, 24.01, 88.49, false),
  ('Q38249810', 'Salar', 'West Bengal', 'Murshidabad', 22894, 23.7748, 88.1026, false),
  ('Q2733670', 'Serpur', 'West Bengal', 'Murshidabad', 8900, 24.13, 88.0, false),
  ('Q48725469', 'Shaikhpara', 'West Bengal', 'Murshidabad', null, 24.265, 88.5514, false),
  ('Q775696', 'Srikantabati', 'West Bengal', 'Murshidabad', 14027, 24.46, 88.05, false),
  ('Q2733674', 'Uttar Mahammadpur', 'West Bengal', 'Murshidabad', 8264, 24.65, 87.99, false),
  ('Q585675', 'Aistala', 'West Bengal', 'Nadia', 20662, 23.18, 88.58, false),
  ('Q75152719', 'Anulia', 'West Bengal', 'Nadia', 5220, 23.1565, 88.5518, false),
  ('Q582270', 'Bablari Dewanganj', 'West Bengal', 'Nadia', 6806, 23.25, 88.22, false),
  ('Q4840991', 'Badkulla', 'West Bengal', 'Nadia', 18051, 23.28, 88.53, false),
  ('Q712402', 'Baruihuda', 'West Bengal', 'Nadia', 11474, 23.3776, 88.4894, false),
  ('Q75152699', 'Beharia', 'West Bengal', 'Nadia', 9584, 23.2313, 88.4687, false),
  ('Q104862289', 'Belgharia, Nadia', 'West Bengal', 'Nadia', null, 23.1228, 88.5549, false),
  ('Q857726', 'Birnagar', 'West Bengal', 'Nadia', 30799, 23.1424, 88.3326, false),
  ('Q857581', 'Chakdaha', 'West Bengal', 'Nadia', 95203, 23.08, 88.52, false),
  ('Q104862560', 'Chanduria', 'West Bengal', 'Nadia', null, 23.0483, 88.5063, false),
  ('Q48724274', 'Chapra', 'West Bengal', 'Nadia', 14123, 23.5371, 88.5527, false),
  ('Q885624', 'Char Brahmanagar', 'West Bengal', 'Nadia', 5053, 23.25, 88.22, false),
  ('Q378395', 'Char Maijdia', 'West Bengal', 'Nadia', 5013, 23.21, 88.22, false),
  ('Q1190825', 'Darappur', 'West Bengal', 'Nadia', 8275, 23.067, 88.652, false),
  ('Q104862853', 'Digha, Nadia', 'West Bengal', 'Nadia', null, 22.9459, 88.5454, false),
  ('Q30624429', 'Gangnapur', 'West Bengal', 'Nadia', 10168, 23.1309, 88.6412, false),
  ('Q104861909', 'Gangni', 'West Bengal', 'Nadia', null, 23.2955, 88.5298, false),
  ('Q1656639', 'Gayespur', 'West Bengal', 'Nadia', 58998, 22.98, 88.48, false),
  ('Q75152723', 'Halalpur Krishnapur', 'West Bengal', 'Nadia', 5202, 23.2035, 88.5886, false),
  ('Q75152656', 'Harindanga', 'West Bengal', 'Nadia', 5440, 23.4932, 88.4673, false),
  ('Q15223039', 'Haringhata', 'West Bengal', 'Nadia', 3989, 22.95, 88.57, false),
  ('Q2007655', 'Jagadanandapur', 'West Bengal', 'Nadia', 23822, 23.72, 88.28, false),
  ('Q2734589', 'Kalyani', 'West Bengal', 'Nadia', 100575, 22.975, 88.4344, false),
  ('Q2330631', 'Karimpur', 'West Bengal', 'Nadia', 9661, 23.9667, 88.6167, false),
  ('Q1006338', 'Krishnanagar', 'West Bengal', 'Nadia', 153062, 23.4, 88.5, false),
  ('Q2237079', 'Kshidirpur', 'West Bengal', 'Nadia', 10556, 23.6074, 88.4018, false),
  ('Q75152768', 'Kulia', 'West Bengal', 'Nadia', 10406, 22.9794, 88.4902, false),
  ('Q2563863', 'Madanpur', 'West Bengal', 'Nadia', 13675, 23.02, 88.48, false),
  ('Q1006330', 'Nabadwip', 'West Bengal', 'Nadia', 125543, 23.4088, 88.3657, false),
  ('Q3870507', 'Nasra', 'West Bengal', 'Nadia', 10707, 23.18, 88.58, false),
  ('Q2733617', 'Parbbatipur', 'West Bengal', 'Nadia', 9584, 23.18, 88.58, false),
  ('Q104860716', 'Paschimbhatjangla', 'West Bengal', 'Nadia', null, 23.3863, 88.4807, false),
  ('Q75152684', 'Patuli', 'West Bengal', 'Nadia', 6441, 23.302, 88.5155, false),
  ('Q2228775', 'Phulia', 'West Bengal', 'Nadia', 55653, 23.24, 88.5, false),
  ('Q75152711', 'Raghabpur', 'West Bengal', 'Nadia', 10280, 23.2131, 88.5489, false),
  ('Q2036954', 'Ranaghat', 'West Bengal', 'Nadia', 75365, 23.18, 88.58, false),
  ('Q104862765', 'Saguna, Nadia', 'West Bengal', 'Nadia', null, 22.9924, 88.4912, false),
  ('Q2035284', 'Santipur', 'West Bengal', 'Nadia', 151777, 23.25, 88.43, false),
  ('Q2733688', 'Satigachha', 'West Bengal', 'Nadia', 9847, 23.18, 88.58, false),
  ('Q104862839', 'Simhat', 'West Bengal', 'Nadia', null, 22.9579, 88.5494, false),
  ('Q7497062', 'Simurali', 'West Bengal', 'Nadia', 5027, 23.0413, 88.5105, false),
  ('Q104860708', 'Sonda, Nadia', 'West Bengal', 'Nadia', null, 23.4073, 88.5232, false),
  ('Q30624592', 'Subarnapur', 'West Bengal', 'Nadia', 5759, 23.1828, 88.5968, false),
  ('Q104860921', 'Tiorkhali', 'West Bengal', 'Nadia', null, 23.4199, 88.4135, false),
  ('Q75152644', 'Uttampur', 'West Bengal', 'Nadia', 13000, 23.9936, 88.6407, false),
  ('Q583568', 'Ashokenagar Kalyangarh', 'West Bengal', 'North 24 Parganas', 121592, 22.833, 88.633, false),
  ('Q55604648', 'Babanpur', 'West Bengal', 'North 24 Parganas', 8942, 22.789, 88.3896, false),
  ('Q585014', 'Baduria', 'West Bengal', 'North 24 Parganas', 52493, 22.74, 88.79, false),
  ('Q16837314', 'Balibhara', 'West Bengal', 'North 24 Parganas', 8521, 22.918, 88.422, false),
  ('Q4853293', 'Bamangachhi', 'West Bengal', 'North 24 Parganas', 6824, 22.74, 88.51, false),
  ('Q55604813', 'Bandipur', 'West Bengal', 'North 24 Parganas', 8115, 22.7357, 88.3957, false),
  ('Q622612', 'Bangaon', 'West Bengal', 'North 24 Parganas', 108864, 23.0435, 88.8318, false),
  ('Q540618', 'Bara Bamonia', 'West Bengal', 'North 24 Parganas', 7193, 22.83, 88.63, false),
  ('Q712504', 'Baranagar', 'West Bengal', 'North 24 Parganas', 245213, 22.64, 88.37, false),
  ('Q685315', 'Barasat', 'West Bengal', 'North 24 Parganas', 278435, 22.7191, 88.4826, false),
  ('Q709298', 'Barrackpore', 'West Bengal', 'North 24 Parganas', 152783, 22.7642, 88.3776, false),
  ('Q712515', 'Basirhat', 'West Bengal', 'North 24 Parganas', 125254, 22.6612, 88.866, false),
  ('Q854914', 'Bhatpara', 'West Bengal', 'North 24 Parganas', 386019, 22.8664, 88.4011, false),
  ('Q796739', 'Bidhannagar', 'West Bengal', 'North 24 Parganas', 632107, 22.58, 88.42, false),
  ('Q55605441', 'Bilkanda', 'West Bengal', 'North 24 Parganas', 6081, 22.7042, 88.4125, false),
  ('Q16858875', 'Chak Barbaria', 'West Bengal', 'North 24 Parganas', 8088, 22.7372, 88.4748, false),
  ('Q55606914', 'Chak Kanthalia', 'West Bengal', 'North 24 Parganas', 11108, 22.7547, 88.3957, false),
  ('Q22290693', 'Chandpara', 'West Bengal', 'North 24 Parganas', 7113, 22.72, 88.59, false),
  ('Q3666115', 'Chandpur', 'West Bengal', 'North 24 Parganas', 10930, 22.68, 88.4438, false),
  ('Q16858940', 'Chandrapur', 'West Bengal', 'North 24 Parganas', 5047, 22.7663, 88.5357, false),
  ('Q16961195', 'Chatta Baria', 'West Bengal', 'North 24 Parganas', 12537, 22.7783, 88.5625, false),
  ('Q55607342', 'Chikanpara', 'West Bengal', 'North 24 Parganas', 9594, 22.9362, 88.7712, false),
  ('Q16953964', 'Dakshin Chatra', 'West Bengal', 'North 24 Parganas', 7275, 22.8414, 88.7657, false),
  ('Q5215726', 'Dandirhat', 'West Bengal', 'North 24 Parganas', 6387, 22.6403, 88.8943, false),
  ('Q16954854', 'Deara', 'West Bengal', 'North 24 Parganas', 11994, 22.6403, 88.4875, false),
  ('Q55609425', 'Deulia', 'West Bengal', 'North 24 Parganas', 9663, 22.6964, 88.6844, false),
  ('Q5268778', 'Dhakuria', 'West Bengal', 'North 24 Parganas', 10165, 22.96, 88.79, false),
  ('Q16960499', 'Dhania', 'West Bengal', 'North 24 Parganas', 6659, 22.9113, 88.5345, false),
  ('Q1259736', 'Dhanyakuria', 'West Bengal', 'North 24 Parganas', 5148, 22.6751, 88.846, false),
  ('Q16960751', 'Digha', 'West Bengal', 'North 24 Parganas', 8159, 22.7553, 88.5247, false),
  ('Q16962151', 'Dogachhia', 'West Bengal', 'North 24 Parganas', 5705, 22.8752, 88.4363, false),
  ('Q649955', 'Dum Dum', 'West Bengal', 'North 24 Parganas', 114786, 22.6333, 88.4228, false),
  ('Q2733355', 'Duttapukur', 'West Bengal', 'North 24 Parganas', 25557, 22.72, 88.48, false),
  ('Q17053345', 'Gangapur', 'West Bengal', 'North 24 Parganas', 6301, 22.7863, 88.5395, false),
  ('Q1656722', 'Garshyamnagar', 'West Bengal', 'North 24 Parganas', 7611, 22.87, 88.41, false),
  ('Q515118', 'Garulia', 'West Bengal', 'North 24 Parganas', 85336, 22.82, 88.37, false),
  ('Q1707370', 'Gobardanga', 'West Bengal', 'North 24 Parganas', 45377, 22.87, 88.76, false),
  ('Q956552', 'Guma', 'West Bengal', 'North 24 Parganas', 12025, 22.83, 88.63, false),
  ('Q1708439', 'Habra', 'West Bengal', 'North 24 Parganas', 147221, 22.83, 88.63, false),
  ('Q1707695', 'Halisahar', 'West Bengal', 'North 24 Parganas', 124939, 22.95, 88.42, false),
  ('Q55613755', 'Hingalganj', 'West Bengal', 'North 24 Parganas', 8179, 22.4708, 88.9833, false),
  ('Q1755801', 'Ichhapur Defence Estate', 'West Bengal', 'North 24 Parganas', 5219, 22.81, 88.37, false),
  ('Q1753775', 'Jafarpur', 'West Bengal', 'North 24 Parganas', 19062, 22.782, 88.386, false),
  ('Q2466050', 'Jetia', 'West Bengal', 'North 24 Parganas', 6349, 22.91, 88.446, false),
  ('Q17067453', 'Joypul', 'West Bengal', 'North 24 Parganas', 16134, 22.7833, 88.5695, false),
  ('Q68953', 'Kamarhati', 'West Bengal', 'North 24 Parganas', 330211, 22.67, 88.37, false),
  ('Q135741979', 'Kamarhati Municipality', 'West Bengal', 'North 24 Parganas', null, 22.6639, 88.3765, false),
  ('Q2088474', 'Kanchrapara', 'West Bengal', 'North 24 Parganas', 129576, 22.9456, 88.4332, false),
  ('Q2120820', 'Kaugachhi', 'West Bengal', 'North 24 Parganas', 17001, 22.78, 88.48, false),
  ('Q2120110', 'Khardah', 'West Bengal', 'North 24 Parganas', 108496, 22.72, 88.38, false),
  ('Q17067632', 'Kokapur', 'West Bengal', 'North 24 Parganas', 6317, 22.7542, 88.4428, false),
  ('Q17067859', 'Koyra', 'West Bengal', 'North 24 Parganas', 11615, 22.7062, 88.5411, false),
  ('Q17068029', 'Kulberia', 'West Bengal', 'North 24 Parganas', 6993, 22.7515, 88.5173, false),
  ('Q2230683', 'Madhyamgram', 'West Bengal', 'North 24 Parganas', 196127, 22.7, 88.45, false),
  ('Q2563874', 'Maslandapur', 'West Bengal', 'North 24 Parganas', 10790, 22.83, 88.63, false),
  ('Q55623191', 'Minakhan', 'West Bengal', 'North 24 Parganas', 3474, 22.5079, 88.7314, false),
  ('Q55623562', 'Mohanpur', 'West Bengal', 'North 24 Parganas', 9096, 22.773, 88.3956, false),
  ('Q2564114', 'Muragachha', 'West Bengal', 'North 24 Parganas', 13249, 22.69, 88.42, false),
  ('Q17069195', 'Nagdaha', 'West Bengal', 'North 24 Parganas', 8192, 22.9267, 88.4765, false),
  ('Q68593', 'Naihati', 'West Bengal', 'North 24 Parganas', 217900, 22.89, 88.42, false),
  ('Q2563840', 'New Barrackpore', 'West Bengal', 'North 24 Parganas', 76846, 22.7, 88.45, false),
  ('Q26236372', 'New Town', 'West Bengal', 'North 24 Parganas', 36541, 22.5894, 88.4748, false),
  ('Q7045541', 'Noapara', 'West Bengal', 'North 24 Parganas', 10819, 22.8222, 88.3696, false),
  ('Q2560647', 'Nokpul', 'West Bengal', 'North 24 Parganas', 7737, 22.83, 88.63, false),
  ('Q2318208', 'North Barrackpore', 'West Bengal', 'North 24 Parganas', 132806, 22.7769, 88.3459, false),
  ('Q36752', 'North Dum Dum', 'West Bengal', 'North 24 Parganas', 249142, 22.6521, 88.4191, false),
  ('Q17069609', 'Palashi', 'West Bengal', 'North 24 Parganas', 6748, 22.9277, 88.4907, false),
  ('Q17069624', 'Palladaha', 'West Bengal', 'North 24 Parganas', 5994, 22.9387, 88.4665, false),
  ('Q17069639', 'Paltapara', 'West Bengal', 'North 24 Parganas', 6408, 22.8083, 88.3943, false),
  ('Q1801463', 'Panihati', 'West Bengal', 'North 24 Parganas', 377347, 22.69, 88.37, false),
  ('Q2733579', 'Patulia', 'West Bengal', 'North 24 Parganas', 16979, 22.7238, 88.397, false),
  ('Q15266073', 'Petrapole', 'West Bengal', 'North 24 Parganas', null, 23.0383, 88.8838, false),
  ('Q2733610', 'Raigachhi', 'West Bengal', 'North 24 Parganas', 8245, 22.7, 88.45, false),
  ('Q2733659', 'Ruiya', 'West Bengal', 'North 24 Parganas', 17661, 22.7418, 88.3996, false),
  ('Q2733472', 'Sadpur', 'West Bengal', 'North 24 Parganas', 7773, 22.86, 88.75, false),
  ('Q116059033', 'Salt Lake', 'West Bengal', 'North 24 Parganas', null, 22.5839, 88.4153, false),
  ('Q17070611', 'Shibalaya', 'West Bengal', 'North 24 Parganas', 5830, 22.7833, 88.5195, false),
  ('Q2733640', 'Sonatikiri', 'West Bengal', 'North 24 Parganas', 6919, 22.68, 88.59, false),
  ('Q41538', 'South Dum Dum', 'West Bengal', 'North 24 Parganas', 403316, 22.61, 88.4, false),
  ('Q3980318', 'Taki', 'West Bengal', 'North 24 Parganas', 38263, 22.59, 88.92, false),
  ('Q2560640', 'Talbandha', 'West Bengal', 'North 24 Parganas', 17802, 22.6907, 88.4373, false),
  ('Q6140247', 'Teghari', 'West Bengal', 'North 24 Parganas', 8491, 22.8972, 87.9872, false),
  ('Q55634881', 'Telenipara', 'West Bengal', 'North 24 Parganas', 17781, 22.7787, 88.4156, false),
  ('Q2287264', 'Titagarh', 'West Bengal', 'North 24 Parganas', 116541, 22.74, 88.37, false),
  ('Q589767', 'Amkula', 'West Bengal', 'Paschim Bardhaman', 5445, 23.6154, 87.0785, false),
  ('Q60743579', 'Amlajora', 'West Bengal', 'Paschim Bardhaman', 5856, 23.4662, 87.3835, false),
  ('Q766990', 'Andal', 'West Bengal', 'Paschim Bardhaman', 19924, 23.6, 87.2, false),
  ('Q202139', 'Asansol', 'West Bengal', 'Paschim Bardhaman', 563917, 23.6833, 86.9667, false),
  ('Q627065', 'Bahula', 'West Bengal', 'Paschim Bardhaman', 17510, 23.6574, 87.196, false),
  ('Q60742947', 'Baidyanathpur', 'West Bengal', 'Paschim Bardhaman', 15704, 23.7203, 87.2786, false),
  ('Q60741817', 'Baktarnagar', 'West Bengal', 'Paschim Bardhaman', 5112, 23.5983, 87.1446, false),
  ('Q625700', 'Ballavpur', 'West Bengal', 'Paschim Bardhaman', 6468, 23.5843, 87.117, false),
  ('Q60743563', 'Bamunara', 'West Bengal', 'Paschim Bardhaman', 6665, 23.5012, 87.3635, false),
  ('Q60742928', 'Banagram', 'West Bengal', 'Paschim Bardhaman', 5635, 23.7153, 87.3241, false),
  ('Q3635848', 'Baska', 'West Bengal', 'Paschim Bardhaman', 6609, 23.5704, 87.173, false),
  ('Q2453382', 'Belebathan', 'West Bengal', 'Paschim Bardhaman', 4459, 23.6387, 87.0644, false),
  ('Q760362', 'Bhanowara', 'West Bengal', 'Paschim Bardhaman', 8855, 23.7386, 87.0276, false),
  ('Q379100', 'Bilpahari', 'West Bengal', 'Paschim Bardhaman', 8565, 23.7208, 87.2348, false),
  ('Q861370', 'Chak Bankola', 'West Bengal', 'Paschim Bardhaman', 11527, 23.6632, 87.2406, false),
  ('Q674808', 'Chapui', 'West Bengal', 'Paschim Bardhaman', 5358, 23.6592, 87.0301, false),
  ('Q886299', 'Chelad', 'West Bengal', 'Paschim Bardhaman', 7471, 23.6398, 87.0277, false),
  ('Q984796', 'Chhora', 'West Bengal', 'Paschim Bardhaman', 13806, 23.6686, 87.1987, false),
  ('Q60740141', 'Chinchuria', 'West Bengal', 'Paschim Bardhaman', 6617, 23.7122, 87.189, false),
  ('Q277935', 'Chittaranjan', 'West Bengal', 'Paschim Bardhaman', 39098, 23.8493, 86.9019, false),
  ('Q16866489', 'Dakshin Khanda', 'West Bengal', 'Paschim Bardhaman', 8449, 23.6199, 87.2171, false),
  ('Q1190642', 'Dalurband', 'West Bengal', 'Paschim Bardhaman', 15107, 23.7117, 87.2564, false),
  ('Q2733172', 'Debipur', 'West Bengal', 'Paschim Bardhaman', 9967, 23.4501, 87.4579, false),
  ('Q1263972', 'Dignala', 'West Bengal', 'Paschim Bardhaman', 13633, 23.586, 87.1949, false),
  ('Q29025772', 'Domohani', 'West Bengal', 'Paschim Bardhaman', 12480, 23.7569, 87.0256, false),
  ('Q5088', 'Durgapur', 'West Bengal', 'Paschim Bardhaman', 566517, 23.55, 87.32, false),
  ('Q60739742', 'Egara', 'West Bengal', 'Paschim Bardhaman', 7623, 23.6093, 87.1004, false),
  ('Q60743551', 'Gopalpur', 'West Bengal', 'Paschim Bardhaman', 15967, 23.5062, 87.3945, false),
  ('Q3783365', 'Haripur', 'West Bengal', 'Paschim Bardhaman', 5910, 23.6834, 87.1973, false),
  ('Q1706832', 'Harishpur', 'West Bengal', 'Paschim Bardhaman', 8980, 23.6047, 87.1701, false),
  ('Q60742912', 'Ichhapur', 'West Bengal', 'Paschim Bardhaman', 4795, 23.6118, 87.2746, false),
  ('Q1320172', 'Jemari (J. K. Nagar Township)', 'West Bengal', 'Paschim Bardhaman', 13179, 23.6573, 87.0668, false),
  ('Q2330656', 'Kajora', 'West Bengal', 'Paschim Bardhaman', 27275, 23.6133, 87.1826, false),
  ('Q583699', 'Kanksa', 'West Bengal', 'Paschim Bardhaman', 23789, 23.4712, 87.4545, false),
  ('Q2138474', 'Kenda', 'West Bengal', 'Paschim Bardhaman', 15731, 23.2, 86.53, false),
  ('Q1117618', 'Kendra Khottamdi', 'West Bengal', 'Paschim Bardhaman', 6875, 23.7167, 87.2087, false),
  ('Q2120464', 'Khandra', 'West Bengal', 'Paschim Bardhaman', 15383, 23.6419, 87.2255, false),
  ('Q2234613', 'Konardihi', 'West Bengal', 'Paschim Bardhaman', 8488, 23.6738, 87.265, false),
  ('Q2241384', 'Kunustara', 'West Bengal', 'Paschim Bardhaman', 5127, 23.6577, 87.1174, false),
  ('Q60742952', 'Mahal', 'West Bengal', 'Paschim Bardhaman', 4841, 23.7034, 87.2896, false),
  ('Q2560598', 'Mahira', 'West Bengal', 'Paschim Bardhaman', 4188, 23.629, 87.2121, false),
  ('Q60741978', 'Majiara', 'West Bengal', 'Paschim Bardhaman', 5444, 23.7249, 87.0176, false),
  ('Q2563914', 'Mandarbani', 'West Bengal', 'Paschim Bardhaman', 4592, 23.7029, 87.3103, false),
  ('Q2560629', 'Murgathaul', 'West Bengal', 'Paschim Bardhaman', 7371, 23.6258, 87.0696, false),
  ('Q60742821', 'Nabaghanapur', 'West Bengal', 'Paschim Bardhaman', 5383, 23.6638, 87.2846, false),
  ('Q2563806', 'Nabgram', 'West Bengal', 'Paschim Bardhaman', 4626, 23.6786, 87.2447, false),
  ('Q60741700', 'Nimsa', 'West Bengal', 'Paschim Bardhaman', 3459, 23.7252, 87.2, false),
  ('Q2733601', 'Palashban', 'West Bengal', 'Paschim Bardhaman', 4811, 23.5847, 87.1632, false),
  ('Q2228766', 'Pangachhiya', 'West Bengal', 'Paschim Bardhaman', 9165, 23.7468, 86.9536, false),
  ('Q60742101', 'Panuria', 'West Bengal', 'Paschim Bardhaman', 8399, 23.8229, 86.9839, false),
  ('Q2228640', 'Parashkol', 'West Bengal', 'Paschim Bardhaman', 10367, 23.48, 87.32, false),
  ('Q2227376', 'Parasia, West Bengal', 'West Bengal', 'Paschim Bardhaman', 8894, 23.65, 87.16, false),
  ('Q2733152', 'Prayagpur', 'West Bengal', 'Paschim Bardhaman', 4479, 23.437, 87.4493, false),
  ('Q2733469', 'Raghunathchak', 'West Bengal', 'Paschim Bardhaman', 6006, 23.5944, 87.1238, false),
  ('Q3929894', 'Ramnagar', 'West Bengal', 'Paschim Bardhaman', 5446, 23.7346, 87.2533, false),
  ('Q2229077', 'Ratibati', 'West Bengal', 'Paschim Bardhaman', 4508, 23.6541, 87.04, false),
  ('Q1708886', 'Rupnarayanpur', 'West Bengal', 'Paschim Bardhaman', 22599, 23.82, 86.9, false),
  ('Q60741854', 'Sahebganj', 'West Bengal', 'Paschim Bardhaman', 4715, 23.5893, 87.106, false),
  ('Q2560710', 'Sankarpur', 'West Bengal', 'Paschim Bardhaman', 6399, 23.6, 87.2, false),
  ('Q1320941', 'Sarpi', 'West Bengal', 'Paschim Bardhaman', 5549, 23.7, 87.08, false),
  ('Q2733166', 'Siduli', 'West Bengal', 'Paschim Bardhaman', 8961, 23.6, 87.2, false),
  ('Q2563850', 'Sirsha', 'West Bengal', 'Paschim Bardhaman', 4600, 23.6849, 87.3017, false),
  ('Q60741698', 'Topsi', 'West Bengal', 'Paschim Bardhaman', 4329, 23.6657, 87.1304, false),
  ('Q2560609', 'Ukhra', 'West Bengal', 'Paschim Bardhaman', 24104, 23.654, 87.243, false),
  ('Q26791803', 'Amlagora', 'West Bengal', 'Paschim Medinipur', 5165, 22.8461, 87.3356, false),
  ('Q627043', 'Balichak', 'West Bengal', 'Paschim Medinipur', 13784, 22.3647, 87.5531, false),
  ('Q859119', 'Chandrakona', 'West Bengal', 'Paschim Medinipur', 23629, 22.73, 87.52, false),
  ('Q48726746', 'Chandrakona Road', 'West Bengal', 'Paschim Medinipur', null, 22.7369, 87.3365, false),
  ('Q104855150', 'Chaulia', 'West Bengal', 'Paschim Medinipur', null, 21.9405, 87.2944, false),
  ('Q2563795', 'Deuli', 'West Bengal', 'Paschim Medinipur', 9007, 22.21, 87.8, false),
  ('Q777157', 'Durllabhganj', 'West Bengal', 'Paschim Medinipur', 6796, 22.73, 87.33, false),
  ('Q104855291', 'Dwarigeria', 'West Bengal', 'Paschim Medinipur', null, 22.7328, 87.3475, false),
  ('Q5522018', 'Garbeta', 'West Bengal', 'Paschim Medinipur', 5109, 22.86, 87.36, false),
  ('Q1707341', 'Ghatal', 'West Bengal', 'Paschim Medinipur', 54591, 22.67, 87.72, false),
  ('Q26788257', 'Kalaikunda', 'West Bengal', 'Paschim Medinipur', 9344, 22.3392, 87.2264, false),
  ('Q588477', 'Kharagpur', 'West Bengal', 'Paschim Medinipur', 207604, 22.3302, 87.3237, false),
  ('Q1929532', 'Kharagpur Railway Settlement', 'West Bengal', 'Paschim Medinipur', 82735, 22.3463, 87.2869, false),
  ('Q2341768', 'Kharar', 'West Bengal', 'Paschim Medinipur', 12118, 22.7, 87.68, false),
  ('Q2232142', 'Kshirpai', 'West Bengal', 'Paschim Medinipur', 16384, 22.711, 87.6174, false),
  ('Q12447537', 'Medinipur', 'West Bengal', 'Paschim Medinipur', 169264, 22.4333, 87.3333, false),
  ('Q2016742', 'Ramjibanpur', 'West Bengal', 'Paschim Medinipur', 19611, 22.83, 87.62, false),
  ('Q60789672', 'Bahir Sarbamangala', 'West Bengal', 'Purba Bardhaman', 12819, 23.2683, 87.8726, false),
  ('Q709267', 'Bardhaman', 'West Bengal', 'Purba Bardhaman', 314265, 23.25, 87.85, false),
  ('Q4983801', 'Bud Bud', 'West Bengal', 'Purba Bardhaman', 4558, 23.4083, 87.5427, false),
  ('Q1191576', 'Dainhat', 'West Bengal', 'Purba Bardhaman', 24397, 23.6063, 88.1715, false),
  ('Q1265005', 'Dhatrigram', 'West Bengal', 'Purba Bardhaman', 9951, 23.21, 88.26, false),
  ('Q934062', 'Gangpur', 'West Bengal', 'Purba Bardhaman', 6347, 23.2185, 87.9164, false),
  ('Q60774835', 'Goda', 'West Bengal', 'Purba Bardhaman', 6483, 23.2591, 87.8386, false),
  ('Q2733364', 'Gopinathpur', 'West Bengal', 'Purba Bardhaman', 4688, 23.22, 88.15, false),
  ('Q1706592', 'Guskara', 'West Bengal', 'Purba Bardhaman', 35388, 23.4928, 87.7347, false),
  ('Q1706950', 'Hatsimla', 'West Bengal', 'Purba Bardhaman', 7141, 23.25, 88.22, false),
  ('Q60796049', 'Jaluidanga', 'West Bengal', 'Purba Bardhaman', 4571, 23.3418, 88.3456, false),
  ('Q2733606', 'Kalna', 'West Bengal', 'Purba Bardhaman', 56722, 23.2172, 88.3522, false),
  ('Q2138465', 'Katwa', 'West Bengal', 'Purba Bardhaman', 81615, 23.65, 88.13, false),
  ('Q2563886', 'Memari', 'West Bengal', 'Purba Bardhaman', 41451, 23.2, 88.12, false),
  ('Q29027092', 'Mirzapur', 'West Bengal', 'Purba Bardhaman', 7733, 23.2834, 87.8817, false),
  ('Q60789688', 'Nari', 'West Bengal', 'Purba Bardhaman', 13072, 23.2474, 87.8916, false),
  ('Q61438918', 'Nasratpur', 'West Bengal', 'Purba Bardhaman', 17044, 23.3268, 88.3296, false),
  ('Q2228519', 'Panuhat', 'West Bengal', 'Purba Bardhaman', 6473, 23.39, 88.08, false),
  ('Q61438962', 'Piarinagar', 'West Bengal', 'Purba Bardhaman', 3678, 23.2576, 88.3424, false),
  ('Q7446494', 'Seharabazar', 'West Bengal', 'Purba Bardhaman', 7858, 23.1156, 87.8051, false),
  ('Q61439009', 'Shashpur', 'West Bengal', 'Purba Bardhaman', 10100, 23.2126, 88.3794, false),
  ('Q2735433', 'Srirampur', 'West Bengal', 'Purba Bardhaman', 19830, 23.35, 88.12, false),
  ('Q2733159', 'Sukdal', 'West Bengal', 'Purba Bardhaman', 13093, 23.3979, 87.5572, false),
  ('Q2733961', 'Uttar Goara', 'West Bengal', 'Purba Bardhaman', 7178, 23.22, 88.17, false),
  ('Q65064109', 'Amalhara', 'West Bengal', 'Purba Medinipur', 14261, 22.4243, 87.8933, false),
  ('Q28173311', 'Amarshi Kasba', 'West Bengal', 'Purba Medinipur', 6400, 22.0631, 87.6024, false),
  ('Q65062251', 'Anantapur', 'West Bengal', 'Purba Medinipur', 5532, 22.3251, 87.8203, false),
  ('Q65064821', 'Ashadtalya', 'West Bengal', 'Purba Medinipur', 5274, 22.057, 87.9458, false),
  ('Q65064784', 'Barda', 'West Bengal', 'Purba Medinipur', 5155, 22.1491, 88.0969, false),
  ('Q65063321', 'Basantia', 'West Bengal', 'Purba Medinipur', 5455, 21.8013, 87.8018, false),
  ('Q65064576', 'Benudia', 'West Bengal', 'Purba Medinipur', 6797, 22.0974, 87.7478, false),
  ('Q1192104', 'Contai', 'West Bengal', 'Purba Medinipur', 92226, 21.78, 87.75, false),
  ('Q1190213', 'Dakshin Baguan', 'West Bengal', 'Purba Medinipur', 5180, 22.32, 87.83, false),
  ('Q1525290', 'Egra', 'West Bengal', 'Purba Medinipur', 30148, 21.9, 87.53, false),
  ('Q65064770', 'Erashal', 'West Bengal', 'Purba Medinipur', 5332, 22.0862, 87.8722, false),
  ('Q65064306', 'Garh Kamalpur', 'West Bengal', 'Purba Medinipur', 6664, 22.1873, 87.9884, false),
  ('Q1706779', 'Goasafat', 'West Bengal', 'Purba Medinipur', 6597, 22.2492, 87.7955, false),
  ('Q12460009', 'Haldia', 'West Bengal', 'Purba Medinipur', 200827, 22.03, 88.06, false),
  ('Q65064598', 'Hincha Gerya', 'West Bengal', 'Purba Medinipur', 4958, 22.0603, 87.7995, false),
  ('Q648349', 'Kakdihi', 'West Bengal', 'Purba Medinipur', 5477, 22.4123, 87.8783, false),
  ('Q65064885', 'Khadalgobra', 'West Bengal', 'Purba Medinipur', 5344, 21.6277, 87.5222, false),
  ('Q65064232', 'Kharisha', 'West Bengal', 'Purba Medinipur', 4120, 22.4296, 87.8511, false),
  ('Q2231690', 'Kolaghat', 'West Bengal', 'Purba Medinipur', 25191, 22.43, 87.87, false),
  ('Q65064765', 'Kotbar', 'West Bengal', 'Purba Medinipur', 6083, 22.1252, 87.812, false),
  ('Q65064113', 'Mihitikri', 'West Bengal', 'Purba Medinipur', 6906, 22.4353, 87.8436, false),
  ('Q3595727', 'Nandigram', 'West Bengal', 'Purba Medinipur', 5803, 22.01, 87.99, false),
  ('Q7131588', 'Panskura', 'West Bengal', 'Purba Medinipur', 57932, 22.42, 87.7, false),
  ('Q28164155', 'Patashpur', 'West Bengal', 'Purba Medinipur', null, 22.0216, 87.5423, false),
  ('Q65064279', 'Shantipur', 'West Bengal', 'Purba Medinipur', 9746, 22.4036, 87.8686, false),
  ('Q118278', 'Tamluk', 'West Bengal', 'Purba Medinipur', 65306, 22.3, 87.9167, false),
  ('Q490892', 'Adra', 'West Bengal', 'Purulia', 14956, 23.4981, 86.6672, false),
  ('Q637505', 'Arra', 'West Bengal', 'Purulia', 21272, 23.5065, 86.6936, false),
  ('Q3633212', 'Balarampur', 'West Bengal', 'Purulia', 24431, 23.0972, 86.2231, false),
  ('Q28153687', 'Bandwan', 'West Bengal', 'Purulia', 5993, 22.876, 86.507, false),
  ('Q637804', 'Barabazar', 'West Bengal', 'Purulia', 8056, 23.36, 86.65, false),
  ('Q4880633', 'Begunkodar', 'West Bengal', 'Purulia', 6347, 23.3528, 86.0566, false),
  ('Q885599', 'Chapari', 'West Bengal', 'Purulia', 6556, 23.7, 86.58, false),
  ('Q63940589', 'Chekya', 'West Bengal', 'Purulia', 5995, 23.3951, 85.9984, false),
  ('Q63940670', 'Dubra', 'West Bengal', 'Purulia', 5506, 23.5474, 86.5182, false),
  ('Q1707129', 'Hijuli', 'West Bengal', 'Purulia', 7917, 23.63, 86.35, false),
  ('Q63940573', 'Hutmura', 'West Bengal', 'Purulia', 5878, 23.3546, 86.4856, false),
  ('Q28154309', 'Jaypur', 'West Bengal', 'Purulia', 10259, 23.4313, 86.1493, false),
  ('Q971904', 'Jhalda', 'West Bengal', 'Purulia', 19544, 23.37, 85.97, false),
  ('Q63940584', 'Kantaranguri', 'West Bengal', 'Purulia', 5435, 23.4894, 86.6627, false),
  ('Q63940587', 'Lagda', 'West Bengal', 'Purulia', 5694, 23.3698, 86.3225, false),
  ('Q63940586', 'Lapara', 'West Bengal', 'Purulia', 5367, 23.422, 86.6622, false),
  ('Q28153688', 'Manbazar', 'West Bengal', 'Purulia', 9521, 23.0615, 86.6642, false),
  ('Q63940582', 'Murulia', 'West Bengal', 'Purulia', 5929, 23.6111, 86.8393, false),
  ('Q28164159', 'Nabagram', 'West Bengal', 'Purulia', 5963, 23.62, 86.472, false),
  ('Q2228725', 'Parbeliya', 'West Bengal', 'Purulia', 5279, 23.63, 86.85, false),
  ('Q307442', 'Purulia', 'West Bengal', 'Purulia', 121067, 23.3333, 86.3667, false),
  ('Q3929423', 'Raghunathpur', 'West Bengal', 'Purulia', 25561, 23.55, 86.67, false),
  ('Q63940581', 'Saltore', 'West Bengal', 'Purulia', 5094, 23.68, 86.8089, false),
  ('Q1382124', 'Santaldih', 'West Bengal', 'Purulia', 2507, 23.6, 86.28, false),
  ('Q63940580', 'Shankara', 'West Bengal', 'Purulia', 11171, 23.4824, 86.5258, false),
  ('Q57813600', 'Abhirampur', 'West Bengal', 'South 24 Parganas', 4618, 22.4657, 88.1692, false),
  ('Q61989339', 'Ajodhyanagar', 'West Bengal', 'South 24 Parganas', 4409, 22.3278, 88.2714, false),
  ('Q388212', 'Amtala', 'West Bengal', 'South 24 Parganas', 8765, 22.22, 88.17, false),
  ('Q57743562', 'Asuti', 'West Bengal', 'South 24 Parganas', 6272, 22.4571, 88.2475, false),
  ('Q26000412', 'Baharu', 'West Bengal', 'South 24 Parganas', 16155, 22.204, 88.4283, false),
  ('Q61989348', 'Bamna', 'West Bengal', 'South 24 Parganas', 4517, 22.2185, 88.3422, false),
  ('Q61989351', 'Baneshwarpur', 'West Bengal', 'South 24 Parganas', 4741, 22.3108, 88.2632, false),
  ('Q61989363', 'Bangsidharpur', 'West Bengal', 'South 24 Parganas', 5218, 22.1686, 88.4099, false),
  ('Q61989324', 'Banshra', 'West Bengal', 'South 24 Parganas', 29521, 22.3685, 88.5492, false),
  ('Q61989345', 'Barijpur', 'West Bengal', 'South 24 Parganas', 5536, 22.2275, 88.2894, false),
  ('Q57970240', 'Barkalikapur', 'West Bengal', 'South 24 Parganas', 4650, 22.3819, 88.2211, false),
  ('Q708616', 'Baruipur', 'West Bengal', 'South 24 Parganas', 53128, 22.3607, 88.4323, false),
  ('Q85745565', 'Baruipur (P)', 'West Bengal', 'South 24 Parganas', null, 22.3652, 88.4525, false),
  ('Q4866245', 'Basanti', 'West Bengal', 'South 24 Parganas', 6625, 22.1892, 88.6706, false),
  ('Q61989328', 'Bayarsing', 'West Bengal', 'South 24 Parganas', 8346, 22.3334, 88.6215, false),
  ('Q57813559', 'Benjanhari Acharial', 'West Bengal', 'South 24 Parganas', 5187, 22.4656, 88.1744, false),
  ('Q61989360', 'Berandari Bagaria', 'West Bengal', 'South 24 Parganas', 10748, 22.1585, 88.2499, false),
  ('Q2453501', 'Bhangar Raghunathpur', 'West Bengal', 'South 24 Parganas', 6037, 22.52, 88.52, false),
  ('Q57970175', 'Bhasa', 'West Bengal', 'South 24 Parganas', 5559, 22.4145, 88.2838, false),
  ('Q4904299', 'Bidyadharpur', 'West Bengal', 'South 24 Parganas', 4630, 22.4233, 88.4537, false),
  ('Q796773', 'Bilandapur', 'West Bengal', 'South 24 Parganas', 6330, 22.2405, 88.3847, false),
  ('Q858399', 'Birlapur', 'West Bengal', 'South 24 Parganas', 22078, 22.4358, 88.1473, false),
  ('Q57970222', 'Bora Gagangohalia', 'West Bengal', 'South 24 Parganas', 5274, 22.3907, 88.2608, false),
  ('Q861312', 'Bowali', 'West Bengal', 'South 24 Parganas', 10968, 22.415, 88.1889, false),
  ('Q858488', 'Budge Budge', 'West Bengal', 'South 24 Parganas', 76837, 22.4737, 88.1739, false),
  ('Q57813514', 'Buita', 'West Bengal', 'South 24 Parganas', 16764, 22.4521, 88.1853, false),
  ('Q4886236', 'Canning', 'West Bengal', 'South 24 Parganas', null, 22.3104, 88.6579, false),
  ('Q19735986', 'Chak Alampur', 'West Bengal', 'South 24 Parganas', 11144, 22.4161, 88.1655, false),
  ('Q55606911', 'Chak Baria', 'West Bengal', 'South 24 Parganas', 4914, 22.4231, 88.5054, false),
  ('Q780560', 'Chak Enayetnagar', 'West Bengal', 'South 24 Parganas', 6754, 22.37, 88.3, false),
  ('Q858529', 'Chak Kashipur', 'West Bengal', 'South 24 Parganas', 12035, 22.42, 88.17, false),
  ('Q19736927', 'Champahati', 'West Bengal', 'South 24 Parganas', 12111, 22.4, 88.5, false),
  ('Q57970229', 'Chanddandaha', 'West Bengal', 'South 24 Parganas', 5656, 22.3811, 88.2341, false),
  ('Q61989352', 'Chandpala Anantapathpur', 'West Bengal', 'South 24 Parganas', 5286, 22.2862, 88.1584, false),
  ('Q889273', 'Chata Kalikapur', 'West Bengal', 'South 24 Parganas', 24985, 22.47, 88.26, false),
  ('Q57813738', 'Dakshin Raypur', 'West Bengal', 'South 24 Parganas', 14076, 22.4043, 88.1512, false),
  ('Q55608949', 'Danga', 'West Bengal', 'South 24 Parganas', 6766, 22.433, 88.3601, false),
  ('Q57970159', 'Daulatpur', 'West Bengal', 'South 24 Parganas', 6568, 22.4354, 88.307, false),
  ('Q61989333', 'Dhamua', 'West Bengal', 'South 24 Parganas', 10055, 22.2875, 88.3962, false),
  ('Q61989361', 'Dhola', 'West Bengal', 'South 24 Parganas', 5804, 22.0385, 88.2979, false),
  ('Q1264213', 'Diamond Harbour', 'West Bengal', 'South 24 Parganas', 41802, 22.1927, 88.1895, false),
  ('Q61989330', 'Dighirpar', 'West Bengal', 'South 24 Parganas', 15881, 22.3034, 88.6678, false),
  ('Q61989336', 'Dihi Kalas', 'West Bengal', 'South 24 Parganas', 11494, 22.2463, 88.3425, false),
  ('Q61989357', 'Durganagar', 'West Bengal', 'South 24 Parganas', 4658, 22.1975, 88.2144, false),
  ('Q61989353', 'Fatepur', 'West Bengal', 'South 24 Parganas', 8105, 22.2868, 88.2324, false),
  ('Q57743478', 'Ganye Gangadharpur', 'West Bengal', 'South 24 Parganas', 5210, 22.472, 88.2668, false),
  ('Q55612314', 'Garia', 'West Bengal', 'South 24 Parganas', 4805, 22.4026, 88.4707, false),
  ('Q60482790', 'Gaur Daha', 'West Bengal', 'South 24 Parganas', 5260, 22.3785, 88.53, false),
  ('Q61989343', 'Ghola Noapara', 'West Bengal', 'South 24 Parganas', 6210, 22.2396, 88.2874, false),
  ('Q55612735', 'Gobindapur', 'West Bengal', 'South 24 Parganas', 9763, 22.5097, 88.6169, false),
  ('Q57743608', 'Hanspukuria', 'West Bengal', 'South 24 Parganas', 3887, 22.4479, 88.2903, false),
  ('Q55613419', 'Hariharpur', 'West Bengal', 'South 24 Parganas', 12027, 22.3874, 88.444, false),
  ('Q61989350', 'Hasimnagar', 'West Bengal', 'South 24 Parganas', 5267, 22.3108, 88.2524, false),
  ('Q2330643', 'Jaynagar Majilpur', 'West Bengal', 'South 24 Parganas', 25922, 22.1752, 88.4201, false),
  ('Q6349333', 'Kakdwip', 'West Bengal', 'South 24 Parganas', 19368, 21.876, 88.1853, false),
  ('Q61989322', 'Kalaria', 'West Bengal', 'South 24 Parganas', 10075, 22.3855, 88.5198, false),
  ('Q61989347', 'Kalikapota', 'West Bengal', 'South 24 Parganas', 13086, 22.2285, 88.3362, false),
  ('Q19795651', 'Kalikapur', 'West Bengal', 'South 24 Parganas', 5860, 22.4252, 88.4961, false),
  ('Q55615603', 'Kalikapur Barasat', 'West Bengal', 'South 24 Parganas', 6104, 22.2206, 88.4464, false),
  ('Q57743648', 'Kalua', 'West Bengal', 'South 24 Parganas', 15735, 22.4541, 88.3124, false),
  ('Q57970211', 'Kanganbaria', 'West Bengal', 'South 24 Parganas', 6657, 22.399, 88.2438, false),
  ('Q2453251', 'Kanyanagar', 'West Bengal', 'South 24 Parganas', 10823, 22.3743, 88.2714, false),
  ('Q55615932', 'Khodar Bazar', 'West Bengal', 'South 24 Parganas', 6360, 22.3605, 88.4271, false),
  ('Q55616147', 'Komarhat', 'West Bengal', 'South 24 Parganas', 5782, 22.319, 88.4537, false),
  ('Q57970269', 'Kriparampur', 'West Bengal', 'South 24 Parganas', 3778, 22.3575, 88.2678, false),
  ('Q61989367', 'Krishna Chandrapur', 'West Bengal', 'South 24 Parganas', 8146, 22.1233, 88.4276, false),
  ('Q61989366', 'Lalpur', 'West Bengal', 'South 24 Parganas', 4691, 22.1303, 88.4233, false),
  ('Q61989338', 'Magrahat', 'West Bengal', 'South 24 Parganas', 17392, 22.242, 88.3784, false),
  ('Q1807947', 'Maheshtala', 'West Bengal', 'South 24 Parganas', 448317, 22.506, 88.2502, false),
  ('Q61989331', 'Makhal Tala', 'West Bengal', 'South 24 Parganas', 11192, 22.3785, 88.5542, false),
  ('Q55621915', 'Mallikpur', 'West Bengal', 'South 24 Parganas', 19120, 22.3986, 88.4281, false),
  ('Q55622171', 'Maricha', 'West Bengal', 'South 24 Parganas', 4842, 22.508, 88.594, false),
  ('Q61989369', 'Mathurapur', 'West Bengal', 'South 24 Parganas', 7797, 22.1203, 88.3943, false),
  ('Q61989329', 'Matla', 'West Bengal', 'South 24 Parganas', 31920, 22.3234, 88.6478, false),
  ('Q57970201', 'Nadabhanga', 'West Bengal', 'South 24 Parganas', 5927, 22.4049, 88.234, false),
  ('Q57970187', 'Nahazari', 'West Bengal', 'South 24 Parganas', 17422, 22.4347, 88.2487, false),
  ('Q61989335', 'Nainan', 'West Bengal', 'South 24 Parganas', 6772, 22.2765, 88.3502, false),
  ('Q55624663', 'Naridana', 'West Bengal', 'South 24 Parganas', 4277, 22.3848, 88.4828, false),
  ('Q15262356', 'Nimpith', 'West Bengal', 'South 24 Parganas', 8014, 22.15, 88.43, false),
  ('Q57813648', 'Nischintapur', 'West Bengal', 'South 24 Parganas', 6353, 22.4608, 88.173, false),
  ('Q61989358', 'Patdaha', 'West Bengal', 'South 24 Parganas', 4993, 22.2577, 88.1593, false),
  ('Q57970252', 'Patharberia', 'West Bengal', 'South 24 Parganas', 4698, 22.3688, 88.2097, false),
  ('Q55629732', 'Petua', 'West Bengal', 'South 24 Parganas', 9596, 22.4143, 88.4489, false),
  ('Q57813766', 'Poali', 'West Bengal', 'South 24 Parganas', 8657, 22.3821, 88.1477, false),
  ('Q2228596', 'Pujali', 'West Bengal', 'South 24 Parganas', 37047, 22.4601, 88.134, false),
  ('Q61989364', 'Purba Bishnupur', 'West Bengal', 'South 24 Parganas', 13060, 22.1583, 88.3942, false),
  ('Q61989365', 'Purba Ranaghat', 'West Bengal', 'South 24 Parganas', 5207, 22.1403, 88.4443, false),
  ('Q55631036', 'Radhanagar', 'West Bengal', 'South 24 Parganas', 6675, 22.4488, 88.4719, false),
  ('Q61989325', 'Rajapur', 'West Bengal', 'South 24 Parganas', 9754, 22.3394, 88.6025, false),
  ('Q261988', 'Rajpur Sonarpur', 'West Bengal', 'South 24 Parganas', 424368, 22.4409, 88.4246, false),
  ('Q57743523', 'Rameswarpur', 'West Bengal', 'South 24 Parganas', 7200, 22.4583, 88.2242, false),
  ('Q57970261', 'Ramkrishnapur', 'West Bengal', 'South 24 Parganas', 5971, 22.3574, 88.2583, false),
  ('Q55631246', 'Raynagar', 'West Bengal', 'South 24 Parganas', 5593, 22.2237, 88.4561, false),
  ('Q55632337', 'Sahebpur', 'West Bengal', 'South 24 Parganas', 7109, 22.4117, 88.4925, false),
  ('Q55632390', 'Salipur', 'West Bengal', 'South 24 Parganas', 5091, 22.3784, 88.4295, false),
  ('Q57743731', 'Samali', 'West Bengal', 'South 24 Parganas', 7180, 22.4171, 88.2633, false),
  ('Q61989355', 'Sangrampur', 'West Bengal', 'South 24 Parganas', 5664, 22.2475, 88.2444, false),
  ('Q61989334', 'Shyampur', 'West Bengal', 'South 24 Parganas', 22024, 22.2815, 88.3882, false),
  ('Q61989340', 'Sirakol', 'West Bengal', 'South 24 Parganas', 10250, 22.3158, 88.2684, false),
  ('Q55633455', 'Solgohalia', 'West Bengal', 'South 24 Parganas', 9373, 22.3952, 88.4993, false),
  ('Q61989337', 'Swangrampur', 'West Bengal', 'South 24 Parganas', 5699, 22.2393, 88.3545, false),
  ('Q61989327', 'Taldi', 'West Bengal', 'South 24 Parganas', 12459, 22.3414, 88.6065, false),
  ('Q16928260', 'Tulshighata', 'West Bengal', 'South 24 Parganas', 4366, 22.1566, 88.4573, false),
  ('Q61989344', 'Usthi', 'West Bengal', 'South 24 Parganas', 6230, 22.2375, 88.2724, false),
  ('Q61989341', 'Uttar Bishnupur', 'West Bengal', 'South 24 Parganas', 4703, 22.2635, 88.3034, false),
  ('Q2733973', 'Uttar Durgapur', 'West Bengal', 'South 24 Parganas', 5723, 21.93, 88.31, false),
  ('Q1928807', 'Uttar Kalas', 'West Bengal', 'South 24 Parganas', 6474, 22.25, 88.35, false),
  ('Q61989346', 'Uttar Kusum', 'West Bengal', 'South 24 Parganas', 10716, 22.2295, 88.3012, false),
  ('Q2560720', 'Uttar Raypur', 'West Bengal', 'South 24 Parganas', 23084, 22.46, 88.2, false),
  ('Q55636831', 'Uttarparanij', 'West Bengal', 'South 24 Parganas', 6810, 22.2042, 88.4477, false),
  ('Q60739941', 'Chopra', 'West Bengal', 'Uttar Dinajpur', 5777, 26.3675, 88.3076, false),
  ('Q1193793', 'Dalkhola', 'West Bengal', 'Uttar Dinajpur', 36930, 25.8758, 87.8401, false),
  ('Q60769599', 'Hanskunda', 'West Bengal', 'Uttar Dinajpur', 5939, 26.1492, 88.0367, false),
  ('Q1753900', 'Islampur', 'West Bengal', 'Uttar Dinajpur', 54340, 26.27, 88.2, false),
  ('Q60768640', 'Itahar', 'West Bengal', 'Uttar Dinajpur', 6022, 25.4587, 88.1722, false),
  ('Q2330594', 'Kaliyaganj', 'West Bengal', 'Uttar Dinajpur', 53530, 25.63, 88.32, false),
  ('Q3813194', 'Kasba', 'West Bengal', 'Uttar Dinajpur', 10067, 25.5856, 88.1122, false),
  ('Q784772', 'Nachhratpur Katabari', 'West Bengal', 'Uttar Dinajpur', 6011, 25.61, 88.1, false),
  ('Q65089751', 'Radhikapur', 'West Bengal', 'Uttar Dinajpur', null, 25.6428, 88.4469, false),
  ('Q2304045', 'Raiganj', 'West Bengal', 'Uttar Dinajpur', 183612, 25.6167, 88.1167, false),
  ('Q121337894', 'Kustia', 'West Bengal', null, null, 22.5325, 88.3747, false),
  ('Q48724857', 'Naoda', 'West Bengal', null, null, 23.9116, 88.4571, false),
  ('Q48724948', 'Raninagar', 'West Bengal', null, null, 24.2391, 88.5464, false),
  ('Q48723777', 'Suti', 'West Bengal', null, null, 24.6224, 88.0243, false)
on conflict (id) do update set
  name = excluded.name, state = excluded.state, district = excluded.district,
  population = excluded.population, lat = excluded.lat, lon = excluded.lon,
  is_metro = excluded.is_metro;

-- ============================================================
-- 20260924003600_project_owner.sql
-- ============================================================
-- ============================================================================
-- Two levels of platform admin.
--
-- Until now one list, platform_admins, gated every operator page. That is
-- fine while the person who runs the company is the only name in it, and
-- wrong the day a support hire is added: they should see who needs a call,
-- not change what a restaurant pays or who else is an admin.
--
--   admin          trial review, the activity list, plans (read), leads,
--                  and the view-only restaurant page.
--   project_owner  everything an admin can, plus: set plans, see payments,
--                  add and remove admins, and read the audit log.
--
-- Whoever is already in the table becomes a project_owner: they were the
-- only operator, so they were the owner in all but name.
--
-- Every change a project owner makes is written to platform_audit. The
-- restaurants' trust in the operator rests on being able to show what was
-- touched and when.
-- ============================================================================

alter table public.platform_admins
  add column if not exists role text not null default 'admin'
  check (role in ('admin', 'project_owner'));

update public.platform_admins set role = 'project_owner'
 where role = 'admin'
   and not exists (select 1 from public.platform_admins where role = 'project_owner');

create or replace function public.is_project_owner()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.platform_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and a.role = 'project_owner'
  )
$$;

-- The signed-in user's level, or null. One call for a page to decide both
-- whether to render and which links to show.
create or replace function public.platform_admin_role()
returns text language sql security definer stable set search_path = public as $$
  select a.role from public.platform_admins a
  where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- platform_audit — what a project owner changed. Append only.
-- ---------------------------------------------------------------------------
create table if not exists public.platform_audit (
  id         uuid primary key default gen_random_uuid(),
  actor      text,                         -- email from the JWT
  action     text not null,                -- e.g. plan.set, admin.add
  target     text,                         -- restaurant id, email, ...
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_created_idx on public.platform_audit (created_at desc);
alter table public.platform_audit enable row level security;
drop policy if exists "platform_audit_owner_read" on public.platform_audit;
create policy "platform_audit_owner_read" on public.platform_audit
  for select using (public.is_project_owner());

create or replace function public.platform_audit_log(
  p_action text, p_target text, p_details jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public as $$
  insert into public.platform_audit (actor, action, target, details)
  values (auth.jwt() ->> 'email', p_action, p_target, coalesce(p_details, '{}'::jsonb))
$$;

create or replace function public.list_platform_audit(p_limit int default 100)
returns table (id uuid, actor text, action text, target text, details jsonb, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select a.id, a.actor, a.action, a.target, a.details, a.created_at
  from public.platform_audit a
  where public.is_project_owner()
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;

-- ---------------------------------------------------------------------------
-- Managing admins. Owner only; the last owner cannot be removed or demoted,
-- or the pages would lock everyone out with no way back short of the SQL
-- editor.
-- ---------------------------------------------------------------------------
create or replace function public.list_platform_admins()
returns table (email text, role text, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select a.email, a.role, a.created_at
  from public.platform_admins a
  where public.is_project_owner()
  order by a.role desc, a.created_at
$$;

create or replace function public.set_platform_admin(p_email text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  em text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_project_owner() then
    raise exception 'not the project owner' using errcode = '42501';
  end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'not an email address' using errcode = '22023';
  end if;
  if p_role not in ('admin', 'project_owner') then
    raise exception 'unknown role %', p_role using errcode = '22023';
  end if;
  if p_role = 'admin' and exists (
    select 1 from public.platform_admins a where lower(a.email) = em and a.role = 'project_owner'
  ) and (select count(*) from public.platform_admins where role = 'project_owner') = 1 then
    raise exception 'cannot demote the last project owner' using errcode = '22023';
  end if;

  insert into public.platform_admins (email, role) values (em, p_role)
  on conflict (email) do update set role = excluded.role;

  perform public.platform_audit_log('admin.set', em, jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.remove_platform_admin(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  em text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_project_owner() then
    raise exception 'not the project owner' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.platform_admins a where lower(a.email) = em and a.role = 'project_owner'
  ) and (select count(*) from public.platform_admins where role = 'project_owner') = 1 then
    raise exception 'cannot remove the last project owner' using errcode = '22023';
  end if;

  delete from public.platform_admins a where lower(a.email) = em;
  if not found then
    raise exception 'no such admin' using errcode = '22023';
  end if;

  perform public.platform_audit_log('admin.remove', em);
end;
$$;

-- ---------------------------------------------------------------------------
-- Setting a plan is money: owner only now, and audited. Same contract as
-- before otherwise (see *_admin_plans.sql).
-- ---------------------------------------------------------------------------
create or replace function public.set_restaurant_plan(
  rid uuid, p_plan text, p_months int
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  new_expiry timestamptz;
  old_plan   text;
  old_expiry timestamptz;
begin
  if not public.is_project_owner() then
    raise exception 'Only the project owner can change plans' using errcode = '42501';
  end if;
  if p_plan not in ('starter', 'pro') then
    raise exception 'Unknown plan %', p_plan using errcode = '22023';
  end if;
  if p_months < 0 or p_months > 120 then
    raise exception 'Term must be between 0 and 120 months' using errcode = '22023';
  end if;

  select r.plan, r.plan_expires_at into old_plan, old_expiry
    from public.restaurants r where r.id = rid;
  if old_plan is null then
    raise exception 'Unknown restaurant %', rid using errcode = '22023';
  end if;

  if p_months = 0 then
    new_expiry := null;
  else
    new_expiry := greatest(now(), coalesce(old_expiry, now())) + (p_months || ' months')::interval;
  end if;

  update public.restaurants
     set plan = p_plan, plan_expires_at = new_expiry, updated_at = now()
   where id = rid;

  perform public.platform_audit_log('plan.set', rid::text, jsonb_build_object(
    'from', jsonb_build_object('plan', old_plan, 'expires_at', old_expiry),
    'to',   jsonb_build_object('plan', p_plan, 'expires_at', new_expiry, 'months', p_months)
  ));

  return jsonb_build_object(
    'plan', p_plan,
    'plan_expires_at', new_expiry,
    'effective_plan', public.restaurant_plan(rid)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments: what restaurants paid us. Owner only. This is the one place
-- money appears in the operator pages, and it is our money, not theirs.
-- ---------------------------------------------------------------------------
create or replace function public.list_payments(p_limit int default 200)
returns table (
  id uuid, restaurant_id uuid, restaurant_name text, restaurant_slug text,
  provider text, provider_order_id text, provider_payment_id text,
  plan text, months int, amount_paise int, status text,
  created_at timestamptz, paid_at timestamptz
)
language sql security definer stable set search_path = public as $$
  select p.id, p.restaurant_id, r.name, r.slug,
         p.provider, p.provider_order_id, p.provider_payment_id,
         p.plan, p.months, p.amount_paise, p.status, p.created_at, p.paid_at
  from public.payments p
  join public.restaurants r on r.id = p.restaurant_id
  where public.is_project_owner()
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

-- ---------------------------------------------------------------------------
-- admin_restaurant_detail() — one restaurant, read only, for support.
-- Profile, plan, setup switches, the staff roster and the menu: what an
-- operator needs to help on a call. Deliberately absent: orders, takings,
-- guests and review text. Those are the restaurant's own business.
-- Payments are included for a project owner only.
-- ---------------------------------------------------------------------------
create or replace function public.admin_restaurant_detail(rid uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  r      public.restaurants%rowtype;
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not a platform admin' using errcode = '42501';
  end if;
  select * into r from public.restaurants where id = rid;
  if not found then
    raise exception 'Unknown restaurant %', rid using errcode = '22023';
  end if;

  result := jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', r.id, 'name', r.name, 'slug', r.slug, 'city', r.city,
      'pincode', r.pincode, 'phone', r.phone, 'gstin', r.gstin,
      'owner_email', (select u.email from auth.users u where u.id = r.owner_id),
      'currency', r.currency, 'default_locale', r.default_locale, 'locales', to_jsonb(r.locales),
      'timezone', r.timezone, 'is_published', r.is_published,
      'is_live', public.restaurant_is_live(r.id),
      'plan', r.plan, 'plan_expires_at', r.plan_expires_at,
      'effective_plan', public.restaurant_plan(r.id),
      'trial_status', r.trial_status, 'trial_ends_at', r.trial_ends_at,
      'ordering_enabled', r.ordering_enabled, 'ordering_paused', r.ordering_paused,
      'table_qr_enabled', r.table_qr_enabled, 'kds_enabled', r.kds_enabled,
      'allow_takeaway', r.allow_takeaway,
      'has_review_link', r.google_review_url is not null,
      'created_at', r.created_at, 'updated_at', r.updated_at
    ),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'display_name', s.display_name, 'email', s.email,
        'role', s.role, 'is_active', s.is_active, 'created_at', s.created_at
      ) order by s.is_active desc, s.role, s.display_name)
      from public.restaurant_staff s where s.restaurant_id = rid
    ), '[]'::jsonb),
    'menu', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name,
        'dishes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', d.id, 'name', d.name, 'price_cents', d.price_cents,
            'is_available', d.is_available, 'has_image', d.image_url is not null
          ) order by d.sort_order, d.name)
          from public.dishes d where d.category_id = c.id
        ), '[]'::jsonb)
      ) order by c.sort_order, c.name)
      from public.categories c where c.restaurant_id = rid
    ), '[]'::jsonb),
    'uncategorised_dishes', (
      select count(*) from public.dishes d
      where d.restaurant_id = rid and d.category_id is null
    )
  );

  if public.is_project_owner() then
    result := result || jsonb_build_object('payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'plan', p.plan, 'months', p.months, 'amount_paise', p.amount_paise,
        'status', p.status, 'created_at', p.created_at, 'paid_at', p.paid_at
      ) order by p.created_at desc)
      from public.payments p where p.restaurant_id = rid
    ), '[]'::jsonb));
  end if;

  return result;
end;
$$;

revoke all on function public.is_project_owner() from public, anon;
revoke all on function public.platform_admin_role() from public, anon;
revoke all on function public.platform_audit_log(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.list_platform_audit(int) from public, anon;
revoke all on function public.list_platform_admins() from public, anon;
revoke all on function public.set_platform_admin(text, text) from public, anon;
revoke all on function public.remove_platform_admin(text) from public, anon;
revoke all on function public.list_payments(int) from public, anon;
revoke all on function public.admin_restaurant_detail(uuid) from public, anon;
grant execute on function public.is_project_owner() to authenticated;
grant execute on function public.platform_admin_role() to authenticated;
grant execute on function public.list_platform_audit(int) to authenticated;
grant execute on function public.list_platform_admins() to authenticated;
grant execute on function public.set_platform_admin(text, text) to authenticated;
grant execute on function public.remove_platform_admin(text) to authenticated;
grant execute on function public.list_payments(int) to authenticated;
grant execute on function public.admin_restaurant_detail(uuid) to authenticated;

-- ============================================================
-- 20260924003700_lead_import.sql
-- ============================================================
-- ============================================================================
-- Leads: import from a JSON file, and the facts a call establishes.
--
-- OpenStreetMap gives names. A JSON file — from Claude with web search, a
-- JustDial export, a field agent's spreadsheet — gives the rest: Google
-- rating, Zomato/Swiggy presence, whether they already have a QR menu.
-- Anything the file does not know is NA, which lands here as null and is
-- shown as unknown, never as "no".
--
-- Google's own API forbids storing its data; a file a person assembled
-- and uploaded is theirs, so these columns hold what they supplied.
-- ============================================================================

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads
  add constraint leads_source_check check (source in ('osm', 'manual', 'import'));

alter table public.leads
  add column if not exists kind                  text
    check (kind is null or kind in ('restaurant', 'cafe', 'dhaba', 'cloud_kitchen',
                                    'bar', 'bakery', 'sweet_shop', 'other')),
  add column if not exists whatsapp              text,
  add column if not exists email                 text,
  add column if not exists contact_person        text,
  add column if not exists locality              text,
  add column if not exists pincode               text,
  add column if not exists google_rating         numeric(2,1)
    check (google_rating is null or (google_rating >= 0 and google_rating <= 5)),
  add column if not exists google_review_count   integer
    check (google_review_count is null or google_review_count >= 0),
  add column if not exists google_maps_url       text,
  add column if not exists google_place_id       text,
  add column if not exists price_level           smallint
    check (price_level is null or (price_level between 1 and 4)),
  add column if not exists opening_hours         text,
  add column if not exists seating               text,
  -- Three-valued on purpose: true, false, or not yet known.
  add column if not exists digital_menu          boolean,
  add column if not exists digital_menu_provider text,
  add column if not exists hard_menu             boolean,
  add column if not exists on_zomato             boolean,
  add column if not exists on_swiggy             boolean,
  add column if not exists online_orders         boolean,
  -- Flipped by the first logged call: a person has confirmed the details.
  add column if not exists verified              boolean not null default false,
  add column if not exists source_url            text,
  -- A public photo of the place, if the file knew of one. Shown, not copied.
  add column if not exists image_url             text,
  -- Whatever else the file carried, so nothing is lost.
  add column if not exists extra                 jsonb not null default '{}'::jsonb;

create index if not exists leads_city_rating_idx
  on public.leads (city_id, google_rating desc nulls last);

-- ---------------------------------------------------------------------------
-- import_leads_json() — one city, many rows. Each row is matched to an
-- existing lead by phone, then by normalised name; a match is updated, the
-- rest are inserted. What a caller typed is never overwritten: contact
-- details only fill blanks, and status, pending, assignment and notes are
-- left alone. Facts the file states (rating, flags) do replace older ones:
-- the file is the newer observation. Returns {inserted, updated}.
--
-- p_rows: [{name, kind, cuisine, phone, whatsapp, email, contact_person,
--           address, locality, pincode, lat, lon, website, website_known
--           (true/false/null), digital_menu, digital_menu_provider,
--           hard_menu, on_zomato, on_swiggy, online_orders,
--           google_rating, google_review_count, google_maps_url,
--           google_place_id, price_level, opening_hours, seating,
--           source_url, image_url, notes, extra}, ...]
-- Nulls mean unknown; the TypeScript side has already turned NA into null.
-- ---------------------------------------------------------------------------
create or replace function public.import_leads_json(p_city_id text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  city_name text;
  r         jsonb;
  lid       uuid;
  n_ins     integer := 0;
  n_upd     integer := 0;
  v_name    text;
  v_phone   text;
  v_digits  text;
  v_norm    text;
  v_website text;
  v_wk      boolean;
  v_notes   text;
begin
  if not public.is_platform_admin() then
    raise exception 'not a platform admin' using errcode = '42501';
  end if;
  select c.name into city_name from public.lead_cities c where c.id = p_city_id;
  if city_name is null then
    raise exception 'unknown city %', p_city_id using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_name := nullif(trim(r ->> 'name'), '');
    if v_name is null then continue; end if;
    v_phone   := nullif(trim(r ->> 'phone'), '');
    v_digits  := right(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), 10);
    v_norm    := public.normalize_hotel_name(v_name);
    v_website := nullif(trim(r ->> 'website'), '');
    v_wk      := (r ->> 'website_known')::boolean;
    v_notes   := nullif(trim(r ->> 'notes'), '');

    -- Find the lead this row is about.
    lid := null;
    if length(v_digits) = 10 then
      select l.id into lid from public.leads l
      where l.city_id = p_city_id
        and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = v_digits
      limit 1;
    end if;
    if lid is null and v_norm is not null then
      select l.id into lid from public.leads l
      where l.city_id = p_city_id and public.normalize_hotel_name(l.name) = v_norm
      limit 1;
    end if;

    if lid is null then
      insert into public.leads
        (city_id, name, source, kind, cuisine, phone, whatsapp, email, contact_person,
         address, locality, pincode, lat, lon, website, website_status,
         digital_menu, digital_menu_provider, hard_menu, on_zomato, on_swiggy,
         online_orders, google_rating, google_review_count, google_maps_url,
         google_place_id, price_level, opening_hours, seating, source_url, image_url, extra,
         restaurant_id, created_by)
      values
        (p_city_id, v_name, 'import',
         nullif(r ->> 'kind', ''), nullif(r ->> 'cuisine', ''), v_phone,
         nullif(r ->> 'whatsapp', ''), nullif(r ->> 'email', ''),
         nullif(r ->> 'contact_person', ''), nullif(r ->> 'address', ''),
         nullif(r ->> 'locality', ''), nullif(r ->> 'pincode', ''),
         (r ->> 'lat')::double precision, (r ->> 'lon')::double precision,
         v_website,
         case when v_website is not null then 'has'
              when v_wk is false then 'none'
              else 'unknown' end,
         (r ->> 'digital_menu')::boolean, nullif(r ->> 'digital_menu_provider', ''),
         (r ->> 'hard_menu')::boolean, (r ->> 'on_zomato')::boolean,
         (r ->> 'on_swiggy')::boolean, (r ->> 'online_orders')::boolean,
         (r ->> 'google_rating')::numeric, (r ->> 'google_review_count')::integer,
         nullif(r ->> 'google_maps_url', ''), nullif(r ->> 'google_place_id', ''),
         (r ->> 'price_level')::smallint, nullif(r ->> 'opening_hours', ''),
         nullif(r ->> 'seating', ''), nullif(r ->> 'source_url', ''),
         nullif(r ->> 'image_url', ''),
         coalesce(r -> 'extra', '{}'::jsonb),
         public.match_lead_restaurant(v_name, v_phone, city_name),
         auth.uid())
      returning id into lid;
      n_ins := n_ins + 1;
      if v_notes is not null then
        insert into public.lead_notes (lead_id, author, body)
        values (lid, auth.jwt() ->> 'email', v_notes);
      end if;
    else
      update public.leads l set
        kind                  = coalesce(l.kind, nullif(r ->> 'kind', '')),
        cuisine               = coalesce(l.cuisine, nullif(r ->> 'cuisine', '')),
        phone                 = coalesce(l.phone, v_phone),
        whatsapp              = coalesce(l.whatsapp, nullif(r ->> 'whatsapp', '')),
        email                 = coalesce(l.email, nullif(r ->> 'email', '')),
        contact_person        = coalesce(l.contact_person, nullif(r ->> 'contact_person', '')),
        address               = coalesce(l.address, nullif(r ->> 'address', '')),
        locality              = coalesce(l.locality, nullif(r ->> 'locality', '')),
        pincode               = coalesce(l.pincode, nullif(r ->> 'pincode', '')),
        lat                   = coalesce(l.lat, (r ->> 'lat')::double precision),
        lon                   = coalesce(l.lon, (r ->> 'lon')::double precision),
        website               = coalesce(l.website, v_website),
        website_status        = case
                                  when l.website is not null or v_website is not null then 'has'
                                  when l.website_status = 'none' then 'none'
                                  when v_wk is false then 'none'
                                  else l.website_status
                                end,
        -- A caller's answer on the phone beats the file; the file beats blank.
        digital_menu          = coalesce(l.digital_menu, (r ->> 'digital_menu')::boolean),
        digital_menu_provider = coalesce(l.digital_menu_provider, nullif(r ->> 'digital_menu_provider', '')),
        hard_menu             = coalesce(l.hard_menu, (r ->> 'hard_menu')::boolean),
        on_zomato             = coalesce((r ->> 'on_zomato')::boolean, l.on_zomato),
        on_swiggy             = coalesce((r ->> 'on_swiggy')::boolean, l.on_swiggy),
        online_orders         = coalesce((r ->> 'online_orders')::boolean, l.online_orders),
        google_rating         = coalesce((r ->> 'google_rating')::numeric, l.google_rating),
        google_review_count   = coalesce((r ->> 'google_review_count')::integer, l.google_review_count),
        google_maps_url       = coalesce(nullif(r ->> 'google_maps_url', ''), l.google_maps_url),
        google_place_id       = coalesce(nullif(r ->> 'google_place_id', ''), l.google_place_id),
        price_level           = coalesce((r ->> 'price_level')::smallint, l.price_level),
        opening_hours         = coalesce(nullif(r ->> 'opening_hours', ''), l.opening_hours),
        seating               = coalesce(l.seating, nullif(r ->> 'seating', '')),
        source_url            = coalesce(nullif(r ->> 'source_url', ''), l.source_url),
        image_url             = coalesce(nullif(r ->> 'image_url', ''), l.image_url),
        extra                 = l.extra || coalesce(r -> 'extra', '{}'::jsonb),
        restaurant_id         = coalesce(l.restaurant_id,
                                  public.match_lead_restaurant(v_name, coalesce(l.phone, v_phone), city_name))
      where l.id = lid;
      n_upd := n_upd + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', n_ins, 'updated', n_upd);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_lead_facts() — what the caller learnt on the phone. Any field left
-- null is "don't change", so the form can send only what was answered.
-- Logging a call also marks the lead verified: a person has spoken to them.
-- ---------------------------------------------------------------------------
create or replace function public.set_lead_facts(
  p_lead_id uuid,
  p_digital_menu boolean default null,
  p_digital_menu_provider text default null,
  p_hard_menu boolean default null,
  p_online_orders boolean default null,
  p_verified boolean default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not a platform admin' using errcode = '42501';
  end if;
  update public.leads l set
    digital_menu          = coalesce(p_digital_menu, l.digital_menu),
    digital_menu_provider = coalesce(nullif(trim(p_digital_menu_provider), ''), l.digital_menu_provider),
    hard_menu             = coalesce(p_hard_menu, l.hard_menu),
    online_orders         = coalesce(p_online_orders, l.online_orders),
    verified              = coalesce(p_verified, l.verified)
  where l.id = p_lead_id;
  if not found then
    raise exception 'unknown lead %', p_lead_id using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.import_leads_json(text, jsonb) from public, anon;
revoke all on function public.set_lead_facts(uuid, boolean, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.import_leads_json(text, jsonb) to authenticated;
grant execute on function public.set_lead_facts(uuid, boolean, text, boolean, boolean, boolean) to authenticated;

-- ============================================================
-- 20260924003800_lead_import_replace.sql
-- ============================================================
-- ============================================================================
-- Importing a file can now replace a city's list instead of updating it.
--
-- "update" is what it was: match by phone then name, fill blanks, never
-- touch what a caller typed. "replace" first removes every lead in the
-- city — and with them their call logs — then imports the file as new.
-- That is a thing to do once, deliberately: owner only, counted back to
-- the caller, and written to the audit log.
-- ============================================================================

drop function if exists public.import_leads_json(text, jsonb);

create or replace function public.import_leads_json(
  p_city_id text, p_rows jsonb, p_mode text default 'update'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  city_name text;
  r         jsonb;
  lid       uuid;
  n_ins     integer := 0;
  n_upd     integer := 0;
  n_rem     integer := 0;
  v_name    text;
  v_phone   text;
  v_digits  text;
  v_norm    text;
  v_website text;
  v_wk      boolean;
  v_notes   text;
begin
  if not public.is_platform_admin() then
    raise exception 'not a platform admin' using errcode = '42501';
  end if;
  if p_mode not in ('update', 'replace') then
    raise exception 'unknown mode %', p_mode using errcode = '22023';
  end if;
  select c.name into city_name from public.lead_cities c where c.id = p_city_id;
  if city_name is null then
    raise exception 'unknown city %', p_city_id using errcode = '22023';
  end if;

  if p_mode = 'replace' then
    if not public.is_project_owner() then
      raise exception 'only the project owner can replace a list' using errcode = '42501';
    end if;
    delete from public.leads l where l.city_id = p_city_id;
    get diagnostics n_rem = row_count;
    perform public.platform_audit_log('leads.replace', p_city_id,
      jsonb_build_object('city', city_name, 'removed', n_rem));
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_name := nullif(trim(r ->> 'name'), '');
    if v_name is null then continue; end if;
    v_phone   := nullif(trim(r ->> 'phone'), '');
    v_digits  := right(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), 10);
    v_norm    := public.normalize_hotel_name(v_name);
    v_website := nullif(trim(r ->> 'website'), '');
    v_wk      := (r ->> 'website_known')::boolean;
    v_notes   := nullif(trim(r ->> 'notes'), '');

    -- Find the lead this row is about. After a replace there is nothing to
    -- find until the file itself repeats a place.
    lid := null;
    if length(v_digits) = 10 then
      select l.id into lid from public.leads l
      where l.city_id = p_city_id
        and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = v_digits
      limit 1;
    end if;
    if lid is null and v_norm is not null then
      select l.id into lid from public.leads l
      where l.city_id = p_city_id and public.normalize_hotel_name(l.name) = v_norm
      limit 1;
    end if;

    if lid is null then
      insert into public.leads
        (city_id, name, source, kind, cuisine, phone, whatsapp, email, contact_person,
         address, locality, pincode, lat, lon, website, website_status,
         digital_menu, digital_menu_provider, hard_menu, on_zomato, on_swiggy,
         online_orders, google_rating, google_review_count, google_maps_url,
         google_place_id, price_level, opening_hours, seating, source_url, image_url, extra,
         restaurant_id, created_by)
      values
        (p_city_id, v_name, 'import',
         nullif(r ->> 'kind', ''), nullif(r ->> 'cuisine', ''), v_phone,
         nullif(r ->> 'whatsapp', ''), nullif(r ->> 'email', ''),
         nullif(r ->> 'contact_person', ''), nullif(r ->> 'address', ''),
         nullif(r ->> 'locality', ''), nullif(r ->> 'pincode', ''),
         (r ->> 'lat')::double precision, (r ->> 'lon')::double precision,
         v_website,
         case when v_website is not null then 'has'
              when v_wk is false then 'none'
              else 'unknown' end,
         (r ->> 'digital_menu')::boolean, nullif(r ->> 'digital_menu_provider', ''),
         (r ->> 'hard_menu')::boolean, (r ->> 'on_zomato')::boolean,
         (r ->> 'on_swiggy')::boolean, (r ->> 'online_orders')::boolean,
         (r ->> 'google_rating')::numeric, (r ->> 'google_review_count')::integer,
         nullif(r ->> 'google_maps_url', ''), nullif(r ->> 'google_place_id', ''),
         (r ->> 'price_level')::smallint, nullif(r ->> 'opening_hours', ''),
         nullif(r ->> 'seating', ''), nullif(r ->> 'source_url', ''),
         nullif(r ->> 'image_url', ''),
         coalesce(r -> 'extra', '{}'::jsonb),
         public.match_lead_restaurant(v_name, v_phone, city_name),
         auth.uid())
      returning id into lid;
      n_ins := n_ins + 1;
      if v_notes is not null then
        insert into public.lead_notes (lead_id, author, body)
        values (lid, auth.jwt() ->> 'email', v_notes);
      end if;
    else
      update public.leads l set
        kind                  = coalesce(l.kind, nullif(r ->> 'kind', '')),
        cuisine               = coalesce(l.cuisine, nullif(r ->> 'cuisine', '')),
        phone                 = coalesce(l.phone, v_phone),
        whatsapp              = coalesce(l.whatsapp, nullif(r ->> 'whatsapp', '')),
        email                 = coalesce(l.email, nullif(r ->> 'email', '')),
        contact_person        = coalesce(l.contact_person, nullif(r ->> 'contact_person', '')),
        address               = coalesce(l.address, nullif(r ->> 'address', '')),
        locality              = coalesce(l.locality, nullif(r ->> 'locality', '')),
        pincode               = coalesce(l.pincode, nullif(r ->> 'pincode', '')),
        lat                   = coalesce(l.lat, (r ->> 'lat')::double precision),
        lon                   = coalesce(l.lon, (r ->> 'lon')::double precision),
        website               = coalesce(l.website, v_website),
        website_status        = case
                                  when l.website is not null or v_website is not null then 'has'
                                  when l.website_status = 'none' then 'none'
                                  when v_wk is false then 'none'
                                  else l.website_status
                                end,
        digital_menu          = coalesce(l.digital_menu, (r ->> 'digital_menu')::boolean),
        digital_menu_provider = coalesce(l.digital_menu_provider, nullif(r ->> 'digital_menu_provider', '')),
        hard_menu             = coalesce(l.hard_menu, (r ->> 'hard_menu')::boolean),
        on_zomato             = coalesce((r ->> 'on_zomato')::boolean, l.on_zomato),
        on_swiggy             = coalesce((r ->> 'on_swiggy')::boolean, l.on_swiggy),
        online_orders         = coalesce((r ->> 'online_orders')::boolean, l.online_orders),
        google_rating         = coalesce((r ->> 'google_rating')::numeric, l.google_rating),
        google_review_count   = coalesce((r ->> 'google_review_count')::integer, l.google_review_count),
        google_maps_url       = coalesce(nullif(r ->> 'google_maps_url', ''), l.google_maps_url),
        google_place_id       = coalesce(nullif(r ->> 'google_place_id', ''), l.google_place_id),
        price_level           = coalesce((r ->> 'price_level')::smallint, l.price_level),
        opening_hours         = coalesce(nullif(r ->> 'opening_hours', ''), l.opening_hours),
        seating               = coalesce(l.seating, nullif(r ->> 'seating', '')),
        source_url            = coalesce(nullif(r ->> 'source_url', ''), l.source_url),
        image_url             = coalesce(nullif(r ->> 'image_url', ''), l.image_url),
        extra                 = l.extra || coalesce(r -> 'extra', '{}'::jsonb),
        restaurant_id         = coalesce(l.restaurant_id,
                                  public.match_lead_restaurant(v_name, coalesce(l.phone, v_phone), city_name))
      where l.id = lid;
      n_upd := n_upd + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'removed', n_rem);
end;
$$;

revoke all on function public.import_leads_json(text, jsonb, text) from public, anon;
grant execute on function public.import_leads_json(text, jsonb, text) to authenticated;
