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
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

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
  phone             text,
  phone_verified_at timestamptz,
  gstin             text,
  city              text,
  pincode           text,
  trial_status      text not null default 'pending'
                    check (trial_status in ('pending', 'active', 'needs_review', 'denied')),
  created_at        timestamptz not null default now()
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
