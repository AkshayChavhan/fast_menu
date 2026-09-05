-- Test scaffolding for the SQL functions in ../schema.sql.
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

-- Stand-in for the RLS helper. Flipped by the ownership test.
create table public.test_flags (owns boolean not null);
insert into public.test_flags values (true);

create or replace function public.owns_restaurant(rid uuid)
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
