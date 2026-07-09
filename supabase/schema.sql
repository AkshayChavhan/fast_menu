-- ============================================================================
-- fast_menu — Supabase schema
-- Multi-tenant QR menu SaaS for hotels, restaurants, cafés & bars.
--
-- Run this in the Supabase SQL editor, or via `supabase db push`.
-- It creates the tables, row-level security (RLS) policies, a storage bucket
-- for dish photos, and a trigger that provisions a restaurant + profile row
-- whenever a new auth user signs up.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles — 1:1 with auth.users; the logged-in restaurant owner/staff
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- restaurants — the tenant. Each owner gets one on signup; they may create more.
-- `slug` is the public URL segment: /m/<slug>
-- ---------------------------------------------------------------------------
create table if not exists public.restaurants (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  slug          text not null unique,
  description   text,
  logo_url      text,
  currency      text not null default 'USD',        -- ISO 4217
  default_locale text not null default 'en',
  locales       text[] not null default array['en'],-- languages the menu is offered in
  is_published  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists restaurants_owner_id_idx on public.restaurants (owner_id);
create index if not exists restaurants_slug_idx on public.restaurants (slug);

-- ---------------------------------------------------------------------------
-- categories — menu sections (Starters, Mains, Drinks…), ordered.
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null,
  -- optional translations: { "es": "Entrantes", "fr": "Entrées" }
  name_i18n     jsonb not null default '{}'::jsonb,
  description   text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists categories_restaurant_id_idx on public.categories (restaurant_id);

-- ---------------------------------------------------------------------------
-- dishes — a menu item. `is_available = false` is the "86'd" state.
-- Allergens stored as text[] (e.g. {gluten, dairy, nuts}).
-- price stored in minor units (cents) to avoid float rounding.
-- ---------------------------------------------------------------------------
create table if not exists public.dishes (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  category_id   uuid references public.categories (id) on delete set null,
  name          text not null,
  name_i18n     jsonb not null default '{}'::jsonb,
  description   text,
  description_i18n jsonb not null default '{}'::jsonb,
  price_cents   integer not null default 0,
  image_url     text,
  allergens     text[] not null default array[]::text[],
  dietary_tags  text[] not null default array[]::text[], -- {vegan, vegetarian, halal, ...}
  is_available  boolean not null default true,            -- false == 86'd
  is_featured   boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists dishes_restaurant_id_idx on public.dishes (restaurant_id);
create index if not exists dishes_category_id_idx on public.dishes (category_id);

-- ---------------------------------------------------------------------------
-- dish_pairings — upsell engine. "Goes well with" / add-on suggestions.
-- self-referential many-to-many across dishes.
-- ---------------------------------------------------------------------------
create table if not exists public.dish_pairings (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  dish_id        uuid not null references public.dishes (id) on delete cascade,
  paired_dish_id uuid not null references public.dishes (id) on delete cascade,
  kind           text not null default 'pairing', -- 'pairing' | 'addon'
  created_at     timestamptz not null default now(),
  unique (dish_id, paired_dish_id, kind),
  check (dish_id <> paired_dish_id)
);
create index if not exists dish_pairings_dish_id_idx on public.dish_pairings (dish_id);
create index if not exists dish_pairings_restaurant_id_idx on public.dish_pairings (restaurant_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists restaurants_set_updated_at on public.restaurants;
create trigger restaurants_set_updated_at
  before update on public.restaurants
  for each row execute function public.set_updated_at();

drop trigger if exists dishes_set_updated_at on public.dishes;
create trigger dishes_set_updated_at
  before update on public.dishes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- New-user provisioning: create a profile + a starter restaurant on signup.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base_slug text;
  final_slug text;
  n int := 0;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  -- derive a slug from email local-part, ensure uniqueness
  base_slug := regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then base_slug := 'restaurant'; end if;
  final_slug := base_slug;
  while exists (select 1 from public.restaurants where slug = final_slug) loop
    n := n + 1;
    final_slug := base_slug || '-' || n;
  end loop;

  insert into public.restaurants (owner_id, name, slug)
  values (new.id, 'My Restaurant', final_slug);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.restaurants   enable row level security;
alter table public.categories    enable row level security;
alter table public.dishes        enable row level security;
alter table public.dish_pairings enable row level security;

-- profiles: owner reads/updates self
drop policy if exists "profiles_self" on public.profiles;
create policy "profiles_self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- restaurants: owner manages own; anyone may read *published* ones (public menu)
drop policy if exists "restaurants_owner_all" on public.restaurants;
create policy "restaurants_owner_all" on public.restaurants
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "restaurants_public_read" on public.restaurants;
create policy "restaurants_public_read" on public.restaurants
  for select using (is_published = true);

-- helper: does the current user own this restaurant?
create or replace function public.owns_restaurant(rid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.restaurants r
    where r.id = rid and r.owner_id = auth.uid()
  );
$$;

-- helper: is this restaurant published? (for public read of child rows)
create or replace function public.restaurant_is_published(rid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.restaurants r
    where r.id = rid and r.is_published = true
  );
$$;

-- categories
drop policy if exists "categories_owner_all" on public.categories;
create policy "categories_owner_all" on public.categories
  for all using (public.owns_restaurant(restaurant_id))
  with check (public.owns_restaurant(restaurant_id));

drop policy if exists "categories_public_read" on public.categories;
create policy "categories_public_read" on public.categories
  for select using (public.restaurant_is_published(restaurant_id));

-- dishes
drop policy if exists "dishes_owner_all" on public.dishes;
create policy "dishes_owner_all" on public.dishes
  for all using (public.owns_restaurant(restaurant_id))
  with check (public.owns_restaurant(restaurant_id));

drop policy if exists "dishes_public_read" on public.dishes;
create policy "dishes_public_read" on public.dishes
  for select using (public.restaurant_is_published(restaurant_id));

-- dish_pairings
drop policy if exists "pairings_owner_all" on public.dish_pairings;
create policy "pairings_owner_all" on public.dish_pairings
  for all using (public.owns_restaurant(restaurant_id))
  with check (public.owns_restaurant(restaurant_id));

drop policy if exists "pairings_public_read" on public.dish_pairings;
create policy "pairings_public_read" on public.dish_pairings
  for select using (public.restaurant_is_published(restaurant_id));

-- ---------------------------------------------------------------------------
-- Storage: public bucket for dish photos & logos
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

drop policy if exists "menu_images_public_read" on storage.objects;
create policy "menu_images_public_read" on storage.objects
  for select using (bucket_id = 'menu-images');

drop policy if exists "menu_images_auth_write" on storage.objects;
create policy "menu_images_auth_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'menu-images');

drop policy if exists "menu_images_auth_update" on storage.objects;
create policy "menu_images_auth_update" on storage.objects
  for update to authenticated using (bucket_id = 'menu-images');

drop policy if exists "menu_images_auth_delete" on storage.objects;
create policy "menu_images_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'menu-images');
