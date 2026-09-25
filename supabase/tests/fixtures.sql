-- Test scaffolding for the SQL functions in ../migrations/.
--
-- The real schema depends on Supabase-only objects (auth.users, storage
-- buckets, RLS), so these tests run against a mirror of just the tables the
-- function under test touches, in a throwaway cluster. See ../../scripts/test-sql.sh.

create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  name          text not null,
  name_i18n     jsonb not null default '{}'::jsonb,
  description   text,
  sort_order    integer not null default 0,
  schedule_id   uuid,
  created_at    timestamptz not null default now()
);

create table public.dishes (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  category_id   uuid references public.categories (id) on delete set null,
  name          text not null,
  name_i18n     jsonb not null default '{}'::jsonb,
  description   text,
  description_i18n jsonb not null default '{}'::jsonb,
  price_cents   integer not null default 0,
  image_url     text,
  allergens     text[] not null default array[]::text[],
  dietary_tags  text[] not null default array[]::text[],
  is_available  boolean not null default true,
  is_featured   boolean not null default false,
  sort_order    integer not null default 0,
  special_from  date,
  special_until date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Stand-in for the RLS role helper. Flipped by the authorisation test.
create table public.test_flags (owns boolean not null);
insert into public.test_flags values (true);

create or replace function public.has_role(rid uuid, roles text[])
returns boolean language sql stable as $$
  select owns from public.test_flags limit 1
$$;

-- Raising on failure makes psql -v ON_ERROR_STOP=1 exit non-zero, so the
-- runner script fails the build without any output parsing.
create or replace function public.assert(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if cond then
    raise notice '  PASS  %', msg;
  else
    raise exception 'FAIL  %', msg;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Trial claims (claim_trial, normalize_hotel_name, review_trial).
-- Stubs for the Supabase-only pieces: auth.uid(), auth.jwt(), auth.users.
-- ---------------------------------------------------------------------------
-- Supabase installs extensions in their own schema and puts that schema on
-- the database's default search_path. A function that pins
-- "set search_path = public" cannot see them there, so the cluster mirrors
-- that layout: an unqualified gen_random_bytes() or similarity() inside such
-- a function fails here exactly as it does on Supabase.
create schema if not exists extensions;
-- pgcrypto is pre-installed there on every Supabase project.
create extension if not exists pgcrypto with schema extensions;
-- pg_trgm is created by our own migration, so it lands in public there.
create extension if not exists pg_trgm with schema public;
alter database schematest set search_path = public, extensions;
set search_path = public, extensions;

create schema if not exists auth;
create table auth.users (
  id                 uuid primary key,
  email              text,
  phone              text,
  phone_confirmed_at timestamptz
);
create table public.test_auth (uid uuid, email text);
insert into public.test_auth values (null, null);

create or replace function auth.uid() returns uuid language sql stable as $$
  select uid from public.test_auth limit 1
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object('email', email) from public.test_auth limit 1
$$;

create table public.restaurants (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null,
  name              text not null,
  slug              text not null unique,
  is_published      boolean not null default false,
  trial_ends_at     timestamptz not null default now() + interval '15 days',
  timezone          text not null default 'Asia/Kolkata',
  currency          text not null default 'INR',
  default_locale    text not null default 'en',
  locales           text[] not null default array['en'],
  google_review_url text,
  table_qr_enabled  boolean not null default false,
  ordering_enabled  boolean not null default false,
  ordering_paused   boolean not null default false,
  pause_message     text,
  allow_takeaway    boolean not null default false,
  kds_enabled       boolean not null default false,
  phone             text,
  phone_verified_at timestamptz,
  gstin             text,
  city              text,
  pincode           text,
  trial_status      text not null default 'pending'
                    check (trial_status in ('pending', 'active', 'needs_review', 'denied')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.platform_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (key, value) values ('trial_verification', 'phone');

create table public.platform_admins (
  email      text primary key,
  created_at timestamptz not null default now()
);

create table public.trial_claims (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null unique references public.restaurants (id) on delete cascade,
  phone_hash      text,
  gstin           text,
  name_normalized text not null,
  pincode         text,
  flagged         boolean not null default false,
  created_at      timestamptz not null default now()
);
create unique index trial_claims_phone_hash_key on public.trial_claims (phone_hash) where phone_hash is not null;
create unique index trial_claims_gstin_key on public.trial_claims (gstin) where gstin is not null;

-- ---------------------------------------------------------------------------
-- Variants and add-ons (set_dish_modifiers).
-- ---------------------------------------------------------------------------
create table public.modifier_groups (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  dish_id       uuid not null references public.dishes (id) on delete cascade,
  name          text not null,
  name_i18n     jsonb not null default '{}'::jsonb,
  kind          text not null check (kind in ('variant', 'addon')),
  min_select    integer not null default 0 check (min_select >= 0),
  max_select    integer check (max_select is null or max_select >= 1),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table public.modifier_options (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  group_id      uuid not null references public.modifier_groups (id) on delete cascade,
  name          text not null,
  name_i18n     jsonb not null default '{}'::jsonb,
  price_cents   integer not null default 0 check (price_cents >= 0),
  is_available  boolean not null default true,
  is_default    boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Menu schedules (schedule_is_open, category_is_open, dish_special_active).
-- ---------------------------------------------------------------------------
create table public.menu_schedules (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null,
  days          smallint[] not null default '{0,1,2,3,4,5,6}',
  starts_at     time not null,
  ends_at       time not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ordering (place_order, get_order_by_code, cancel_order_by_code,
-- create_service_request, check_rate_limit and the total triggers).
-- ---------------------------------------------------------------------------
create table public.tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  label         text not null,
  qr_token      text not null default encode(gen_random_bytes(6), 'hex'),
  capacity      integer,
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, qr_token),
  unique (restaurant_id, label)
);
create table public.table_sessions (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  status            text not null default 'open' check (status in ('open', 'bill_requested', 'closed')),
  service_type      text not null default 'dine_in' check (service_type in ('dine_in', 'takeaway')),
  guest_label       text,
  opened_by         uuid,
  opened_at         timestamptz not null default now(),
  bill_requested_at timestamptz,
  closed_at         timestamptz,
  closed_by         uuid,
  total_cents       integer not null default 0,
  payment_method    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create table public.table_session_tables (
  session_id uuid not null references public.table_sessions (id) on delete cascade,
  table_id   uuid not null references public.tables (id) on delete cascade,
  primary key (session_id, table_id)
);
create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  code            text not null,
  status          text not null default 'placed' check (status in ('placed', 'approved', 'settled', 'rejected', 'cancelled')),
  source          text not null default 'customer' check (source in ('customer', 'waiter')),
  service_type    text not null default 'dine_in' check (service_type in ('dine_in', 'takeaway')),
  table_id        uuid references public.tables (id) on delete set null,
  session_id      uuid references public.table_sessions (id) on delete set null,
  note            text,
  subtotal_cents  integer not null default 0,
  currency        text not null,
  locale          text,
  device_key      text,
  created_by      uuid,
  approved_by     uuid,
  approved_at     timestamptz,
  last_edited_by  uuid,
  last_edited_at  timestamptz,
  rejected_reason text,
  expires_at      timestamptz not null default now() + interval '2 hours',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, code)
);
create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  restaurant_id    uuid not null,
  dish_id          uuid references public.dishes (id) on delete set null,
  name             text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity         integer not null check (quantity between 1 and 99),
  line_total_cents integer generated always as (unit_price_cents * quantity) stored,
  variant          jsonb,
  addons           jsonb not null default '[]'::jsonb,
  note             text,
  kds_status       text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);
create table public.order_events (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  restaurant_id uuid not null,
  actor_id      uuid,
  kind          text not null,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create table public.service_requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  table_id      uuid references public.tables (id) on delete set null,
  session_id    uuid references public.table_sessions (id) on delete set null,
  kind          text not null check (kind in ('call_waiter', 'request_bill')),
  status        text not null default 'open' check (status in ('open', 'done')),
  device_key    text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid
);
create table public.rate_limit_buckets (
  key          text primary key,
  window_start timestamptz not null,
  count        integer not null default 0
);
