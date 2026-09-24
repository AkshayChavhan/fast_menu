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
  -- Free-trial window. The account is "locked" (public menu hidden, publishing
  -- blocked) once trial_ends_at <= now(). To unlock a paying customer, extend
  -- this (e.g. set it far in the future) — there is no separate paid flag yet.
  trial_ends_at timestamptz not null default now() + interval '14 days',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists restaurants_owner_id_idx on public.restaurants (owner_id);
create index if not exists restaurants_slug_idx on public.restaurants (slug);

-- Migration for existing databases: `create table if not exists` above won't add
-- trial_ends_at to a table that already exists, so add + backfill it here. Any
-- pre-existing restaurant gets a fresh 14-day trial from when this runs, so no
-- one is locked out on launch. Idempotent — safe to re-run.
alter table public.restaurants
  add column if not exists trial_ends_at timestamptz;
update public.restaurants
  set trial_ends_at = now() + interval '14 days'
  where trial_ends_at is null;
alter table public.restaurants
  alter column trial_ends_at set default now() + interval '14 days',
  alter column trial_ends_at set not null;

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

  insert into public.restaurants (owner_id, name, slug, trial_ends_at)
  values (new.id, 'My Restaurant', final_slug, now() + interval '14 days');

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

-- Public read requires the menu to be published AND the trial still active.
-- An expired trial makes the row read as absent to anonymous visitors, so the
-- public menu auto-hides with no application-code change.
drop policy if exists "restaurants_public_read" on public.restaurants;
create policy "restaurants_public_read" on public.restaurants
  for select using (is_published = true and trial_ends_at > now());

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

-- ============================================================================
-- Guest reviews
--
-- Two tables:
--   review_forms — per-restaurant settings for the public review page. The
--     star-rated prompts live in a `questions` jsonb array rather than their
--     own table: they are always read and written as a whole form, and a
--     submitted review snapshots the wording it was answered against, so
--     there is nothing to join back to.
--   reviews — one guest submission. Lands as 'pending' and only becomes
--     visible on the public menu once the owner approves it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- review_forms — 1:1 with restaurants. Created on first save from the
-- dashboard; the app falls back to defaults when the row is absent.
-- ---------------------------------------------------------------------------
create table if not exists public.review_forms (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null unique references public.restaurants (id) on delete cascade,
  -- Master switch. When false the public review page 404s and the review QR
  -- stops resolving, without deleting any settings.
  is_enabled    boolean not null default true,
  headline      text not null default 'How was your visit?',
  intro         text,
  -- [{ "id": "<uuid>", "prompt": "How was the food?" }, ...] — order is the
  -- display order. Ids are generated client-side and are stable across edits
  -- so historical reviews keep pointing at the right prompt.
  questions     jsonb not null default '[]'::jsonb,
  ask_name      boolean not null default true,
  ask_comment   boolean not null default true,
  comment_label text not null default 'Anything else you''d like to share?',
  thank_you_message text not null default 'Thank you for your feedback!',
  -- Whether approved reviews drift across the bottom of the public menu.
  show_on_menu  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists review_forms_restaurant_id_idx on public.review_forms (restaurant_id);

-- ---------------------------------------------------------------------------
-- reviews — a guest submission, awaiting approval by default.
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  guest_name     text,
  comment        text,
  -- [{ "question_id": "<uuid>", "prompt": "How was the food?", "rating": 5 }]
  -- `prompt` is snapshotted so an owner editing the form later doesn't rewrite
  -- history on reviews that were answered against the old wording.
  ratings        jsonb not null default '[]'::jsonb,
  -- Mean of the star answers, for display and sorting. Null when the form had
  -- no questions (comment-only submission).
  overall_rating numeric(2,1),
  status         text not null default 'pending'
                 check (status in ('pending', 'approved', 'hidden')),
  created_at     timestamptz not null default now()
);
create index if not exists reviews_restaurant_id_idx on public.reviews (restaurant_id);
create index if not exists reviews_status_idx on public.reviews (restaurant_id, status, created_at desc);

drop trigger if exists review_forms_set_updated_at on public.review_forms;
create trigger review_forms_set_updated_at
  before update on public.review_forms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Can anonymous guests post a review to this restaurant right now?
-- Stricter than restaurant_is_published(): an expired trial or a disabled
-- review form must block *writes*, not just hide reads. security definer so
-- the policy can read restaurants/review_forms without recursing into RLS.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_accepts_reviews(rid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.restaurants r
    left join public.review_forms f on f.restaurant_id = r.id
    where r.id = rid
      and r.is_published = true
      and r.trial_ends_at > now()
      and coalesce(f.is_enabled, true) = true
  );
$$;

alter table public.review_forms enable row level security;
alter table public.reviews      enable row level security;

-- review_forms: owner manages; public reads it to render the review page.
drop policy if exists "review_forms_owner_all" on public.review_forms;
create policy "review_forms_owner_all" on public.review_forms
  for all using (public.owns_restaurant(restaurant_id))
  with check (public.owns_restaurant(restaurant_id));

drop policy if exists "review_forms_public_read" on public.review_forms;
create policy "review_forms_public_read" on public.review_forms
  for select using (public.restaurant_is_published(restaurant_id));

-- reviews: owner sees and moderates everything.
drop policy if exists "reviews_owner_all" on public.reviews;
create policy "reviews_owner_all" on public.reviews
  for all using (public.owns_restaurant(restaurant_id))
  with check (public.owns_restaurant(restaurant_id));

-- Anyone who can reach the review page may submit, but only ever as 'pending'
-- — pinning status in the policy stops a crafted request self-approving.
drop policy if exists "reviews_public_insert" on public.reviews;
create policy "reviews_public_insert" on public.reviews
  for insert to anon, authenticated
  with check (
    public.restaurant_accepts_reviews(restaurant_id)
    and status = 'pending'
  );

-- Only approved reviews are publicly readable (the floating words on the menu).
drop policy if exists "reviews_public_read" on public.reviews;
create policy "reviews_public_read" on public.reviews
  for select using (
    status = 'approved' and public.restaurant_is_published(restaurant_id)
  );

-- ============================================================================
-- Menu import
--
-- Replaces a restaurant's entire menu from a JSON payload in one transaction.
-- This has to be a database function rather than a sequence of client calls:
-- the import deletes everything first, so a network failure halfway through
-- the re-insert would leave the restaurant with an empty menu. A plpgsql
-- function is atomic, so it either fully lands or fully rolls back.
--
-- `payload` is already normalised and validated by the app (prices in cents,
-- arrays present, unknown allergens dropped) — this function does no coercion
-- beyond reading the jsonb.
--
-- Note: deleting the dishes cascades to dish_pairings, so an import clears any
-- "goes well with" links. The dashboard warns about this before applying.
-- ============================================================================
create or replace function public.import_menu(rid uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cat        jsonb;
  dish       jsonb;
  new_cat_id uuid;
  cat_idx    int := 0;
  dish_idx   int;
  n_cats     int := 0;
  n_dishes   int := 0;
begin
  -- security definer bypasses RLS, so ownership is checked explicitly here.
  if not public.owns_restaurant(rid) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;

  delete from public.dishes where restaurant_id = rid;
  delete from public.categories where restaurant_id = rid;

  for cat in
    select value from jsonb_array_elements(coalesce(payload -> 'categories', '[]'::jsonb))
  loop
    insert into public.categories (restaurant_id, name, name_i18n, description, sort_order)
    values (
      rid,
      cat ->> 'name',
      coalesce(cat -> 'name_i18n', '{}'::jsonb),
      nullif(cat ->> 'description', ''),
      cat_idx
    )
    returning id into new_cat_id;

    n_cats  := n_cats + 1;
    cat_idx := cat_idx + 1;

    dish_idx := 0;
    for dish in
      select value from jsonb_array_elements(coalesce(cat -> 'dishes', '[]'::jsonb))
    loop
      insert into public.dishes (
        restaurant_id, category_id, name, name_i18n, description, description_i18n,
        price_cents, image_url, allergens, dietary_tags,
        is_available, is_featured, sort_order
      )
      values (
        rid,
        new_cat_id,
        dish ->> 'name',
        coalesce(dish -> 'name_i18n', '{}'::jsonb),
        nullif(dish ->> 'description', ''),
        coalesce(dish -> 'description_i18n', '{}'::jsonb),
        coalesce((dish ->> 'price_cents')::int, 0),
        nullif(dish ->> 'image_url', ''),
        array(select jsonb_array_elements_text(coalesce(dish -> 'allergens', '[]'::jsonb))),
        array(select jsonb_array_elements_text(coalesce(dish -> 'dietary_tags', '[]'::jsonb))),
        coalesce((dish ->> 'is_available')::boolean, true),
        coalesce((dish ->> 'is_featured')::boolean, false),
        dish_idx
      );

      n_dishes := n_dishes + 1;
      dish_idx := dish_idx + 1;
    end loop;
  end loop;

  -- Dishes with no category, kept so an export/import round-trip doesn't
  -- silently drop the "More" bucket the public menu renders.
  dish_idx := 0;
  for dish in
    select value from jsonb_array_elements(coalesce(payload -> 'dishes', '[]'::jsonb))
  loop
    insert into public.dishes (
      restaurant_id, category_id, name, name_i18n, description, description_i18n,
      price_cents, image_url, allergens, dietary_tags,
      is_available, is_featured, sort_order
    )
    values (
      rid,
      null,
      dish ->> 'name',
      coalesce(dish -> 'name_i18n', '{}'::jsonb),
      nullif(dish ->> 'description', ''),
      coalesce(dish -> 'description_i18n', '{}'::jsonb),
      coalesce((dish ->> 'price_cents')::int, 0),
      nullif(dish ->> 'image_url', ''),
      array(select jsonb_array_elements_text(coalesce(dish -> 'allergens', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(dish -> 'dietary_tags', '[]'::jsonb))),
      coalesce((dish ->> 'is_available')::boolean, true),
      coalesce((dish ->> 'is_featured')::boolean, false),
      dish_idx
    );

    n_dishes := n_dishes + 1;
    dish_idx := dish_idx + 1;
  end loop;

  return jsonb_build_object('categories', n_cats, 'dishes', n_dishes);
end;
$$;

revoke all on function public.import_menu(uuid, jsonb) from public, anon;
grant execute on function public.import_menu(uuid, jsonb) to authenticated;
