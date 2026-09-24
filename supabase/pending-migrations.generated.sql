-- fast_menu — all migrations pending on this database, in order.
-- Generated 2026-09-24 18:43. Baseline (20260924000000) is already
-- applied and is NOT included. Run this whole file once in the Supabase SQL editor.

-- ============================================================
-- 20260924000100_restaurant_ordering_flags.sql
-- ============================================================
-- ============================================================================
-- Restaurant-level switches for table ordering, the timezone that schedules
-- and reports are evaluated in, and a 15-day free trial.
--
-- Every switch defaults to off, so a restaurant that only wants a QR menu
-- sees no change until its owner opts in from Settings.
-- ============================================================================

alter table public.restaurants
  -- IANA zone name (e.g. 'Asia/Kolkata'). Menu schedules, "today's specials"
  -- and day-end reports are all evaluated in this zone, never the server's.
  add column if not exists timezone          text    not null default 'Asia/Kolkata',
  -- Master switch: customers can build a cart and place orders.
  add column if not exists ordering_enabled  boolean not null default false,
  -- Temporary stop ("kitchen closed") without unpublishing the menu.
  add column if not exists ordering_paused   boolean not null default false,
  add column if not exists pause_message     text,
  -- One QR per table (with the table pre-filled) instead of one per menu.
  add column if not exists table_qr_enabled  boolean not null default false,
  -- Kitchen ticket screen. Off means order items carry no kitchen state.
  add column if not exists kds_enabled       boolean not null default false,
  -- Let customers choose parcel/takeaway when placing an order.
  add column if not exists allow_takeaway    boolean not null default false,
  -- Shown to guests after they pay so they can review the venue on Google.
  add column if not exists google_review_url text;

-- ---------------------------------------------------------------------------
-- Free trial: 15 days. The signup trigger no longer hard-codes the window; it
-- relies on the column default so there is one place to change it.
-- ---------------------------------------------------------------------------
alter table public.restaurants
  alter column trial_ends_at set default now() + interval '15 days';

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


-- ============================================================
-- 20260924000200_staff_roles.sql
-- ============================================================
-- ============================================================================
-- Staff accounts and roles.
--
-- The owner stays restaurants.owner_id. Everyone else who works at a
-- restaurant — manager, cashier, waiter, kitchen — is a row in
-- restaurant_staff. Authorization reads this table through member_role();
-- it never trusts JWT metadata, which a user can edit.
--
-- A staff user belongs to exactly one restaurant (unique user_id), so login
-- routing is a single lookup. Owners can still own several restaurants.
-- ============================================================================

create table if not exists public.restaurant_staff (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null check (role in ('manager', 'cashier', 'waiter', 'kitchen')),
  display_name  text,
  -- Deactivating keeps the row (and the audit trail) but revokes every
  -- permission at once; the login itself still works but lands nowhere.
  is_active     boolean not null default true,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists restaurant_staff_user_id_key
  on public.restaurant_staff (user_id);
create index if not exists restaurant_staff_restaurant_role_idx
  on public.restaurant_staff (restaurant_id, role);

drop trigger if exists restaurant_staff_set_updated_at on public.restaurant_staff;
create trigger restaurant_staff_set_updated_at
  before update on public.restaurant_staff
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Role helpers. security definer so policies can consult restaurants and
-- restaurant_staff without recursing into their own RLS.
-- ---------------------------------------------------------------------------

-- The signed-in user's role at a restaurant: 'owner', a staff role, or null.
create or replace function public.member_role(rid uuid)
returns text language sql security definer stable set search_path = public as $$
  select case
    when exists (
      select 1 from public.restaurants r
      where r.id = rid and r.owner_id = auth.uid()
    ) then 'owner'
    else (
      select s.role from public.restaurant_staff s
      where s.restaurant_id = rid
        and s.user_id = auth.uid()
        and s.is_active
      limit 1
    )
  end
$$;

-- Does the signed-in user hold one of `roles` at this restaurant?
create or replace function public.has_role(rid uuid, roles text[])
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(public.member_role(rid) = any (roles), false)
$$;

-- ---------------------------------------------------------------------------
-- New-user provisioning: staff accounts are created by an admin through the
-- Auth Admin API with app_metadata.app_role set. They get a profile but no
-- restaurant of their own. (app_metadata is server-controlled; user_metadata
-- would be editable by the user and must not be trusted here.)
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

  if coalesce(new.raw_app_meta_data ->> 'app_role', '') in ('manager', 'cashier', 'waiter', 'kitchen') then
    return new;
  end if;

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

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.restaurant_staff enable row level security;

-- Anyone can read their own staff row (login routing, "where do I work").
drop policy if exists "staff_self_read" on public.restaurant_staff;
create policy "staff_self_read" on public.restaurant_staff
  for select using (user_id = auth.uid());

-- Owners and managers see the whole roster.
drop policy if exists "staff_manage_read" on public.restaurant_staff;
create policy "staff_manage_read" on public.restaurant_staff
  for select using (public.has_role(restaurant_id, array['owner', 'manager']));

-- Owners manage every role; managers manage everyone below manager.
drop policy if exists "staff_manage_write" on public.restaurant_staff;
create policy "staff_manage_write" on public.restaurant_staff
  for all using (
    public.has_role(restaurant_id, array['owner'])
    or (public.has_role(restaurant_id, array['manager']) and role <> 'manager')
  )
  with check (
    public.has_role(restaurant_id, array['owner'])
    or (public.has_role(restaurant_id, array['manager']) and role <> 'manager')
  );

-- Staff need to read the restaurant they work at (name, currency, switches).
-- Updates stay owner-only; the few fields other roles may change go through
-- role-checked functions.
drop policy if exists "restaurants_member_read" on public.restaurants;
create policy "restaurants_member_read" on public.restaurants
  for select using (public.member_role(id) is not null);

-- Menu, pairings and reviews: owners and managers manage them.
drop policy if exists "categories_owner_all" on public.categories;
drop policy if exists "categories_manage_all" on public.categories;
create policy "categories_manage_all" on public.categories
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));

drop policy if exists "dishes_owner_all" on public.dishes;
drop policy if exists "dishes_manage_all" on public.dishes;
create policy "dishes_manage_all" on public.dishes
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));

drop policy if exists "pairings_owner_all" on public.dish_pairings;
drop policy if exists "pairings_manage_all" on public.dish_pairings;
create policy "pairings_manage_all" on public.dish_pairings
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));

drop policy if exists "review_forms_owner_all" on public.review_forms;
drop policy if exists "review_forms_manage_all" on public.review_forms;
create policy "review_forms_manage_all" on public.review_forms
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));

drop policy if exists "reviews_owner_all" on public.reviews;
drop policy if exists "reviews_manage_all" on public.reviews;
create policy "reviews_manage_all" on public.reviews
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));

-- ---------------------------------------------------------------------------
-- import_menu(): managers may import too. Only the authorisation line
-- changes; the body is otherwise the baseline's.
-- ---------------------------------------------------------------------------
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
  -- security definer bypasses RLS, so the role is checked explicitly here.
  if not public.has_role(rid, array['owner', 'manager']) then
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


-- ============================================================
-- 20260924000300_staff_email.sql
-- ============================================================
-- ============================================================================
-- Keep each staff member's login email on their staff row.
--
-- Emails live in auth.users, which only the service role can read. The
-- roster page would otherwise need one Admin API call per row just to show
-- who is who. Staff emails are set by the admin who creates the account and
-- there is no self-service way to change them, so a copy here stays correct.
-- ============================================================================

alter table public.restaurant_staff
  add column if not exists email text;


-- ============================================================
-- 20260924000400_trial_claims.sql
-- ============================================================
-- ============================================================================
-- One free trial per hotel.
--
-- A trial belongs to a restaurant, not to an email address, so signing up
-- again with a second email must not earn a second trial. Before a new
-- restaurant's trial starts, its owner claims it with three identifiers:
--
--   1. a mobile number — verified by OTP when trial_verification = 'phone'
--      — and refused outright if another hotel already claimed it;
--   2. an optional GSTIN, refused outright on an exact match;
--   3. the hotel's name and pincode: a close name in the same pincode is not
--      refused (two "Hotel Sai" in one area is plausible) but parked as
--      needs_review for a platform admin to approve or deny.
--
-- Restaurants that already exist when this runs are grandfathered as active.
-- ============================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- platform_settings — operator switches, edited in the SQL editor only.
--   trial_verification: 'phone' requires an OTP-verified number (needs an SMS
--   provider under Authentication → Providers → Phone); 'none' skips the OTP
--   but still runs every duplicate check. Start on 'none' until SMS is wired.
-- ---------------------------------------------------------------------------
create table if not exists public.platform_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (key, value)
values ('trial_verification', 'phone')
on conflict (key) do nothing;

alter table public.platform_settings enable row level security;
drop policy if exists "platform_settings_read" on public.platform_settings;
create policy "platform_settings_read" on public.platform_settings
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- platform_admins — emails allowed to review flagged trials. Add rows in the
-- SQL editor: insert into public.platform_admins (email) values ('you@x.com');
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admins (
  email      text primary key,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.platform_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

drop policy if exists "platform_admins_self" on public.platform_admins;
create policy "platform_admins_self" on public.platform_admins
  for select using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- restaurants — identity fields and the trial state machine:
--   pending      → owner has not claimed yet; dashboard shows the claim page
--   active       → trial (or paid) running
--   needs_review → claimed, but a similar hotel exists; publishing blocked
--   denied       → duplicate; dashboard locked, contact support
-- ---------------------------------------------------------------------------
alter table public.restaurants
  add column if not exists phone             text,
  add column if not exists phone_verified_at timestamptz,
  add column if not exists gstin             text,
  add column if not exists city              text,
  add column if not exists pincode           text,
  -- Added as 'active' so every existing restaurant is grandfathered, then the
  -- default flips to 'pending' for restaurants created from now on.
  add column if not exists trial_status      text not null default 'active';

alter table public.restaurants alter column trial_status set default 'pending';
alter table public.restaurants drop constraint if exists restaurants_trial_status_check;
alter table public.restaurants add constraint restaurants_trial_status_check
  check (trial_status in ('pending', 'active', 'needs_review', 'denied'));

-- ---------------------------------------------------------------------------
-- trial_claims — one row per restaurant that has claimed a trial. The phone
-- is stored hashed; it is only ever compared for equality.
-- ---------------------------------------------------------------------------
create table if not exists public.trial_claims (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null unique references public.restaurants (id) on delete cascade,
  phone_hash      text,
  gstin           text,
  name_normalized text not null,
  pincode         text,
  flagged         boolean not null default false,
  created_at      timestamptz not null default now()
);
create unique index if not exists trial_claims_phone_hash_key
  on public.trial_claims (phone_hash) where phone_hash is not null;
create unique index if not exists trial_claims_gstin_key
  on public.trial_claims (gstin) where gstin is not null;
create index if not exists trial_claims_name_trgm_idx
  on public.trial_claims using gin (name_normalized gin_trgm_ops);
create index if not exists trial_claims_pincode_idx
  on public.trial_claims (pincode);

alter table public.trial_claims enable row level security;
-- No policies on purpose: only the functions below read or write this table.

-- ---------------------------------------------------------------------------
-- Name normalisation for the fuzzy check: lower-case, strip punctuation and
-- the generic words that appear in most hotel names, collapse whitespace.
-- "Hotel Sai Palace, Pune" → "sai palace pune".
-- ---------------------------------------------------------------------------
create or replace function public.normalize_hotel_name(name text)
returns text language sql immutable as $$
  select nullif(trim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', ' ', 'g'),
      '\m(hotel|hotels|restaurant|restaurants|restro|cafe|the|bar|dhaba|and|family|garden|pvt|ltd|new)\M',
      ' ', 'g'),
    '\s+', ' ', 'g')), '')
$$;

-- ---------------------------------------------------------------------------
-- claim_trial() — called by the owner from the claim page.
-- Returns {status: active | needs_review | denied | error, reason}.
-- ---------------------------------------------------------------------------
create or replace function public.claim_trial(
  rid uuid, p_phone text, p_gstin text, p_city text, p_pincode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.restaurants%rowtype;
  mode       text;
  auth_phone text;
  auth_conf  timestamptz;
  digits     text;
  hash       text;
  gst        text;
  pin        text;
  norm       text;
  status     text;
  reason     text := null;
begin
  select * into r from public.restaurants where id = rid;
  if r.id is null or r.owner_id <> auth.uid() then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;

  if r.trial_status = 'active' then
    return jsonb_build_object('status', 'active', 'reason', null);
  end if;
  if r.trial_status = 'denied' then
    return jsonb_build_object('status', 'denied', 'reason', 'already_denied');
  end if;

  select value into mode from public.platform_settings where key = 'trial_verification';
  mode := coalesce(mode, 'phone');

  -- Canonical form: digits only, no leading zeros. The app supplies the
  -- country code; in phone mode Auth has already stored the number in E.164.
  digits := ltrim(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '0');
  if length(digits) < 8 or length(digits) > 15 then
    return jsonb_build_object('status', 'error', 'reason', 'phone_invalid');
  end if;

  -- The number must be the one Supabase Auth verified for this user.
  if mode = 'phone' then
    select u.phone, u.phone_confirmed_at into auth_phone, auth_conf
    from auth.users u where u.id = auth.uid();
    if auth_conf is null
       or ltrim(regexp_replace(coalesce(auth_phone, ''), '[^0-9]', '', 'g'), '0') <> digits then
      return jsonb_build_object('status', 'error', 'reason', 'phone_unverified');
    end if;
  end if;

  gst := nullif(upper(regexp_replace(coalesce(p_gstin, ''), '[^0-9A-Za-z]', '', 'g')), '');
  if gst is not null and gst !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    return jsonb_build_object('status', 'error', 'reason', 'gstin_invalid');
  end if;

  pin  := nullif(regexp_replace(coalesce(p_pincode, ''), '[^0-9]', '', 'g'), '');
  hash := encode(digest(digits, 'sha256'), 'hex');
  norm := coalesce(
    public.normalize_hotel_name(r.name),
    nullif(trim(regexp_replace(lower(r.name), '[^a-z0-9]+', ' ', 'g')), ''),
    'restaurant'
  );

  if exists (
    select 1 from public.trial_claims c
    where c.phone_hash = hash and c.restaurant_id <> rid
  ) then
    status := 'denied'; reason := 'phone';
  elsif gst is not null and exists (
    select 1 from public.trial_claims c
    where c.gstin = gst and c.restaurant_id <> rid
  ) then
    status := 'denied'; reason := 'gstin';
  elsif pin is not null and exists (
    select 1 from public.trial_claims c
    where c.restaurant_id <> rid
      and c.pincode = pin
      and similarity(c.name_normalized, norm) >= 0.6
  ) then
    status := 'needs_review'; reason := 'similar_name';
  else
    status := 'active';
  end if;

  if status <> 'denied' then
    insert into public.trial_claims
      (restaurant_id, phone_hash, gstin, name_normalized, pincode, flagged)
    values
      (rid, hash, gst, norm, pin, status = 'needs_review')
    on conflict (restaurant_id) do update set
      phone_hash      = excluded.phone_hash,
      gstin           = excluded.gstin,
      name_normalized = excluded.name_normalized,
      pincode         = excluded.pincode,
      flagged         = excluded.flagged;
  end if;

  update public.restaurants set
    phone             = digits,
    phone_verified_at = case when mode = 'phone' then now() else phone_verified_at end,
    gstin             = gst,
    city              = nullif(trim(coalesce(p_city, '')), ''),
    pincode           = pin,
    trial_status      = status,
    -- The 15 days start when the trial actually opens, not at signup.
    trial_ends_at     = case when status = 'active' then now() + interval '15 days' else trial_ends_at end
  where id = rid;

  return jsonb_build_object('status', status, 'reason', reason);
end;
$$;

revoke all on function public.claim_trial(uuid, text, text, text, text) from public, anon;
grant execute on function public.claim_trial(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Publishing needs an active trial. Belt and braces for the app-level check.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_trial_before_publish()
returns trigger language plpgsql as $$
begin
  if new.is_published and not old.is_published and new.trial_status <> 'active' then
    raise exception 'The trial is not active, so the menu cannot be published'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists restaurants_enforce_trial on public.restaurants;
create trigger restaurants_enforce_trial
  before update of is_published on public.restaurants
  for each row execute function public.enforce_trial_before_publish();

-- ---------------------------------------------------------------------------
-- Platform admin review of flagged claims.
-- ---------------------------------------------------------------------------
create or replace function public.list_trial_reviews()
returns table (
  restaurant_id uuid,
  name          text,
  slug          text,
  city          text,
  pincode       text,
  phone         text,
  gstin         text,
  owner_email   text,
  created_at    timestamptz,
  lookalikes    jsonb
)
language sql security definer stable set search_path = public as $$
  select
    r.id, r.name, r.slug, r.city, r.pincode, r.phone, r.gstin, u.email::text, r.created_at,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', o.name, 'slug', o.slug, 'city', o.city, 'trial_status', o.trial_status
             ) order by o.created_at), '[]'::jsonb)
      from public.trial_claims mine
      join public.trial_claims c
        on c.restaurant_id <> mine.restaurant_id
       and c.pincode = mine.pincode
       and similarity(c.name_normalized, mine.name_normalized) >= 0.6
      join public.restaurants o on o.id = c.restaurant_id
      where mine.restaurant_id = r.id
    )
  from public.restaurants r
  join auth.users u on u.id = r.owner_id
  where r.trial_status = 'needs_review'
    and public.is_platform_admin()
  order by r.created_at
$$;

create or replace function public.review_trial(rid uuid, approve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not a platform admin' using errcode = '42501';
  end if;

  if approve then
    update public.restaurants
       set trial_status = 'active', trial_ends_at = now() + interval '15 days'
     where id = rid and trial_status in ('needs_review', 'denied');
    update public.trial_claims set flagged = false where restaurant_id = rid;
  else
    update public.restaurants
       set trial_status = 'denied', is_published = false
     where id = rid;
    delete from public.trial_claims where restaurant_id = rid;
  end if;
end;
$$;

revoke all on function public.list_trial_reviews() from public, anon;
grant execute on function public.list_trial_reviews() to authenticated;
revoke all on function public.review_trial(uuid, boolean) from public, anon;
grant execute on function public.review_trial(uuid, boolean) to authenticated;


-- ============================================================
-- 20260924000500_ordering_pause.sql
-- ============================================================
-- ============================================================================
-- Pause ordering ("kitchen closed") without unpublishing the menu.
--
-- Managers hold ordering:pause but may not update restaurants directly (that
-- policy stays owner-only), so the switch goes through a role-checked
-- function. Owners use the same path so there is one code path to test.
-- ============================================================================

create or replace function public.set_ordering_paused(rid uuid, paused boolean, message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(rid, array['owner', 'manager']) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;

  update public.restaurants
     set ordering_paused = paused,
         pause_message   = nullif(trim(coalesce(message, '')), '')
   where id = rid;
end;
$$;

revoke all on function public.set_ordering_paused(uuid, boolean, text) from public, anon;
grant execute on function public.set_ordering_paused(uuid, boolean, text) to authenticated;


-- ============================================================
-- 20260924000600_tables.sql
-- ============================================================
-- ============================================================================
-- Tables — the physical tables of a restaurant.
--
-- Each table carries a stable qr_token. The per-table QR code encodes
-- /m/<slug>?t=<token>, so an owner can rename "Table 5" to "Patio 2" without
-- reprinting anything. Labels are what staff and guests see; tokens are what
-- the printed code says.
-- ============================================================================

create table if not exists public.tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  label         text not null,
  qr_token      text not null default encode(gen_random_bytes(6), 'hex'),
  capacity      integer check (capacity is null or capacity > 0),
  sort_order    integer not null default 0,
  -- Inactive tables keep their history but are hidden from staff pickers and
  -- their QR stops resolving.
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, qr_token),
  unique (restaurant_id, label)
);
create index if not exists tables_restaurant_id_idx
  on public.tables (restaurant_id, sort_order);

drop trigger if exists tables_set_updated_at on public.tables;
create trigger tables_set_updated_at
  before update on public.tables
  for each row execute function public.set_updated_at();

alter table public.tables enable row level security;

-- Owners and managers manage the floor plan.
drop policy if exists "tables_manage_all" on public.tables;
create policy "tables_manage_all" on public.tables
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));

-- Every role at the restaurant can read tables (waiter pickers, billing).
drop policy if exists "tables_member_read" on public.tables;
create policy "tables_member_read" on public.tables
  for select using (public.member_role(restaurant_id) is not null);

-- Guests resolve ?t=<token> to a label on a published menu. Only active
-- tables: a retired code should read as unknown.
drop policy if exists "tables_public_read" on public.tables;
create policy "tables_public_read" on public.tables
  for select using (is_active and public.restaurant_is_published(restaurant_id));


-- ============================================================
-- 20260924000700_modifiers.sql
-- ============================================================
-- ============================================================================
-- Variants and add-ons ("modifiers") on a dish.
--
-- A dish may carry any number of modifier groups, each of one kind:
--   variant — the guest picks exactly one option (Half / Full, Small / Large)
--             and that option's price_cents *replaces* the dish price;
--   addon   — the guest picks zero or more options (extra cheese, egg) and
--             each option's price_cents is *added*.
-- Only what the admin defines exists: a dish with no groups is ordered as
-- itself at its own price, so restaurants without half plates never see one.
--
-- Order items snapshot the chosen option names and prices, so groups can be
-- rewritten freely without touching history.
-- ============================================================================

create table if not exists public.modifier_groups (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  dish_id       uuid not null references public.dishes (id) on delete cascade,
  name          text not null,
  name_i18n     jsonb not null default '{}'::jsonb,
  kind          text not null check (kind in ('variant', 'addon')),
  -- addon groups only: how many options the guest must / may pick.
  -- (A variant group is always exactly one.)
  min_select    integer not null default 0 check (min_select >= 0),
  max_select    integer check (max_select is null or max_select >= 1),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists modifier_groups_dish_id_idx
  on public.modifier_groups (dish_id, sort_order);
create index if not exists modifier_groups_restaurant_id_idx
  on public.modifier_groups (restaurant_id);

create table if not exists public.modifier_options (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  group_id      uuid not null references public.modifier_groups (id) on delete cascade,
  name          text not null,
  name_i18n     jsonb not null default '{}'::jsonb,
  -- variant: the full price of the dish in this size; addon: the extra.
  price_cents   integer not null default 0 check (price_cents >= 0),
  -- The admin's own 86 switch for a single option (out of large plates).
  is_available  boolean not null default true,
  -- variant: preselected in the guest's sheet.
  is_default    boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists modifier_options_group_id_idx
  on public.modifier_options (group_id, sort_order);
create index if not exists modifier_options_restaurant_id_idx
  on public.modifier_options (restaurant_id);

drop trigger if exists modifier_groups_set_updated_at on public.modifier_groups;
create trigger modifier_groups_set_updated_at
  before update on public.modifier_groups
  for each row execute function public.set_updated_at();
drop trigger if exists modifier_options_set_updated_at on public.modifier_options;
create trigger modifier_options_set_updated_at
  before update on public.modifier_options
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: owners and managers manage; everyone at the restaurant reads; the
-- public reads on a published menu (the sheet needs options and prices).
-- ---------------------------------------------------------------------------
alter table public.modifier_groups  enable row level security;
alter table public.modifier_options enable row level security;

drop policy if exists "modifier_groups_manage_all" on public.modifier_groups;
create policy "modifier_groups_manage_all" on public.modifier_groups
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));
drop policy if exists "modifier_groups_member_read" on public.modifier_groups;
create policy "modifier_groups_member_read" on public.modifier_groups
  for select using (public.member_role(restaurant_id) is not null);
drop policy if exists "modifier_groups_public_read" on public.modifier_groups;
create policy "modifier_groups_public_read" on public.modifier_groups
  for select using (public.restaurant_is_published(restaurant_id));

drop policy if exists "modifier_options_manage_all" on public.modifier_options;
create policy "modifier_options_manage_all" on public.modifier_options
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));
drop policy if exists "modifier_options_member_read" on public.modifier_options;
create policy "modifier_options_member_read" on public.modifier_options
  for select using (public.member_role(restaurant_id) is not null);
drop policy if exists "modifier_options_public_read" on public.modifier_options;
create policy "modifier_options_public_read" on public.modifier_options
  for select using (public.restaurant_is_published(restaurant_id));

-- ---------------------------------------------------------------------------
-- set_dish_modifiers(dish, payload) — replace a dish's groups atomically.
--
-- payload: [
--   { "name": "Size", "kind": "variant", "min_select": 1, "max_select": 1,
--     "options": [ { "name": "Half", "price_cents": 12000, "is_default": true,
--                    "is_available": true }, ... ] },
--   { "name": "Extras", "kind": "addon", "min_select": 0, "max_select": null,
--     "options": [ ... ] }
-- ]
-- The app validates shape and trims strings; this function re-checks the
-- rules that matter for money and refuses with 22023 (invalid parameter).
-- ---------------------------------------------------------------------------
create or replace function public.set_dish_modifiers(p_dish_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rid        uuid;
  grp        jsonb;
  opt        jsonb;
  grp_kind   text;
  grp_id     uuid;
  g_idx      int := 0;
  o_idx      int;
  n_groups   int := 0;
  n_options  int := 0;
  n_in_group int;
begin
  select restaurant_id into rid from public.dishes where id = p_dish_id;
  if rid is null then
    raise exception 'Dish % not found', p_dish_id using errcode = '22023';
  end if;
  if not public.has_role(rid, array['owner', 'manager']) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(payload, '[]'::jsonb)) <> 'array' then
    raise exception 'payload must be an array' using errcode = '22023';
  end if;

  delete from public.modifier_groups where dish_id = p_dish_id;

  for grp in select value from jsonb_array_elements(coalesce(payload, '[]'::jsonb)) loop
    grp_kind := grp ->> 'kind';
    if grp_kind not in ('variant', 'addon') then
      raise exception 'Unknown modifier kind "%"', grp_kind using errcode = '22023';
    end if;
    if nullif(trim(coalesce(grp ->> 'name', '')), '') is null then
      raise exception 'A modifier group is missing a name' using errcode = '22023';
    end if;

    insert into public.modifier_groups
      (restaurant_id, dish_id, name, name_i18n, kind, min_select, max_select, sort_order)
    values (
      rid,
      p_dish_id,
      trim(grp ->> 'name'),
      coalesce(grp -> 'name_i18n', '{}'::jsonb),
      grp_kind,
      case when grp_kind = 'variant' then 1
           else greatest(coalesce((grp ->> 'min_select')::int, 0), 0) end,
      case when grp_kind = 'variant' then 1
           else nullif((grp ->> 'max_select')::int, 0) end,
      g_idx
    )
    returning id into grp_id;

    n_groups := n_groups + 1;
    g_idx := g_idx + 1;
    o_idx := 0;
    n_in_group := 0;

    for opt in select value from jsonb_array_elements(coalesce(grp -> 'options', '[]'::jsonb)) loop
      if nullif(trim(coalesce(opt ->> 'name', '')), '') is null then
        raise exception 'An option in "%" is missing a name', trim(grp ->> 'name')
          using errcode = '22023';
      end if;
      insert into public.modifier_options
        (restaurant_id, group_id, name, name_i18n, price_cents, is_available, is_default, sort_order)
      values (
        rid,
        grp_id,
        trim(opt ->> 'name'),
        coalesce(opt -> 'name_i18n', '{}'::jsonb),
        greatest(coalesce((opt ->> 'price_cents')::int, 0), 0),
        coalesce((opt ->> 'is_available')::boolean, true),
        coalesce((opt ->> 'is_default')::boolean, false) and grp_kind = 'variant',
        o_idx
      );
      n_options := n_options + 1;
      n_in_group := n_in_group + 1;
      o_idx := o_idx + 1;
    end loop;

    if grp_kind = 'variant' and n_in_group = 0 then
      raise exception 'Variant group "%" needs at least one option', trim(grp ->> 'name')
        using errcode = '22023';
    end if;
  end loop;

  return jsonb_build_object('groups', n_groups, 'options', n_options);
end;
$$;

revoke all on function public.set_dish_modifiers(uuid, jsonb) from public, anon;
grant execute on function public.set_dish_modifiers(uuid, jsonb) to authenticated;


-- ============================================================
-- 20260924000800_schedules_specials.sql
-- ============================================================
-- ============================================================================
-- Menu schedules and daily specials.
--
-- A schedule is a weekly window ("Breakfast: Mon–Sun 07:00–11:00") in the
-- restaurant's own timezone. A category may point at one schedule; outside
-- the window the category is hidden from the public menu and its dishes
-- cannot be ordered. Windows may cross midnight (22:00–02:00).
--
-- A special is a dish with a date window (special_from / special_until, in
-- the restaurant's local calendar). Inside the window it is highlighted
-- under "Today's specials"; outside it is hidden and cannot be ordered. A
-- dish with no dates is an ordinary dish.
-- ============================================================================

create table if not exists public.menu_schedules (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null,
  -- 0 = Sunday … 6 = Saturday, matching extract(dow …).
  days          smallint[] not null default '{0,1,2,3,4,5,6}',
  starts_at     time not null,
  ends_at       time not null,
  -- An inactive schedule stops restricting; its categories show all day.
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists menu_schedules_restaurant_id_idx
  on public.menu_schedules (restaurant_id);

drop trigger if exists menu_schedules_set_updated_at on public.menu_schedules;
create trigger menu_schedules_set_updated_at
  before update on public.menu_schedules
  for each row execute function public.set_updated_at();

alter table public.categories
  add column if not exists schedule_id uuid references public.menu_schedules (id) on delete set null;
create index if not exists categories_schedule_id_idx on public.categories (schedule_id);

alter table public.dishes
  add column if not exists special_from  date,
  add column if not exists special_until date;

alter table public.menu_schedules enable row level security;

drop policy if exists "menu_schedules_manage_all" on public.menu_schedules;
create policy "menu_schedules_manage_all" on public.menu_schedules
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));
drop policy if exists "menu_schedules_member_read" on public.menu_schedules;
create policy "menu_schedules_member_read" on public.menu_schedules
  for select using (public.member_role(restaurant_id) is not null);
drop policy if exists "menu_schedules_public_read" on public.menu_schedules;
create policy "menu_schedules_public_read" on public.menu_schedules
  for select using (public.restaurant_is_published(restaurant_id));

-- ---------------------------------------------------------------------------
-- Is a schedule open at `at`, in its restaurant's timezone? Missing or
-- inactive schedules are "open" (they do not restrict). Overnight windows
-- count the window's start day: 22:00–02:00 on {Fri} covers Fri 22:00 to
-- Sat 02:00.
-- ---------------------------------------------------------------------------
create or replace function public.schedule_is_open(sid uuid, at timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s        public.menu_schedules%rowtype;
  tz       text;
  local_ts timestamp;
  d        int;
  prev_d   int;
  t        time;
begin
  if sid is null then return true; end if;
  select * into s from public.menu_schedules where id = sid;
  if s.id is null or not s.is_active then return true; end if;

  select timezone into tz from public.restaurants where id = s.restaurant_id;
  local_ts := at at time zone coalesce(tz, 'UTC');
  d := extract(dow from local_ts)::int;
  prev_d := (d + 6) % 7;
  t := local_ts::time;

  if s.starts_at <= s.ends_at then
    return d = any (s.days) and t >= s.starts_at and t < s.ends_at;
  end if;
  return (d = any (s.days) and t >= s.starts_at)
      or (prev_d = any (s.days) and t < s.ends_at);
end;
$$;

-- A category with no schedule is always open.
create or replace function public.category_is_open(cid uuid, at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.schedule_is_open(c.schedule_id, at) from public.categories c where c.id = cid),
    true
  )
$$;

-- A dish outside its special window is off the menu; no window means always.
create or replace function public.dish_special_active(did uuid, at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (d.special_from is null or d.special_from <= (at at time zone r.timezone)::date)
       and (d.special_until is null or d.special_until >= (at at time zone r.timezone)::date)
    from public.dishes d
    join public.restaurants r on r.id = d.restaurant_id
    where d.id = did
  ), true)
$$;


-- ============================================================
-- 20260924000900_import_menu_modifiers.sql
-- ============================================================
-- ============================================================================
-- Menu import learns variants, add-ons, special dates and schedules.
--
-- The JSON payload may now carry, per dish, "special_from" / "special_until"
-- and a "modifiers" array in the same shape set_dish_modifiers() accepts, and
-- per category a "schedule" name that resolves to one of the restaurant's
-- existing schedules (unknown names simply leave the category unscheduled).
--
-- The modifier rows are written by one internal helper that both
-- set_dish_modifiers() and import_menu() call, so the money rules live in
-- exactly one place.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- insert_dish_modifiers(rid, dish, payload) — write a dish's groups from a
-- payload that has already been authorised. Not callable by clients.
-- Returns the number of options written.
-- ---------------------------------------------------------------------------
create or replace function public.insert_dish_modifiers(rid uuid, p_dish_id uuid, payload jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  grp        jsonb;
  opt        jsonb;
  grp_kind   text;
  grp_id     uuid;
  g_idx      int := 0;
  o_idx      int;
  n_options  int := 0;
  n_in_group int;
begin
  if payload is null or jsonb_typeof(payload) <> 'array' then
    return 0;
  end if;

  for grp in select value from jsonb_array_elements(payload) loop
    grp_kind := grp ->> 'kind';
    if grp_kind not in ('variant', 'addon') then
      raise exception 'Unknown modifier kind "%"', grp_kind using errcode = '22023';
    end if;
    if nullif(trim(coalesce(grp ->> 'name', '')), '') is null then
      raise exception 'A modifier group is missing a name' using errcode = '22023';
    end if;

    insert into public.modifier_groups
      (restaurant_id, dish_id, name, name_i18n, kind, min_select, max_select, sort_order)
    values (
      rid,
      p_dish_id,
      trim(grp ->> 'name'),
      coalesce(grp -> 'name_i18n', '{}'::jsonb),
      grp_kind,
      case when grp_kind = 'variant' then 1
           else greatest(coalesce((grp ->> 'min_select')::int, 0), 0) end,
      case when grp_kind = 'variant' then 1
           else nullif((grp ->> 'max_select')::int, 0) end,
      g_idx
    )
    returning id into grp_id;

    g_idx := g_idx + 1;
    o_idx := 0;
    n_in_group := 0;

    for opt in select value from jsonb_array_elements(coalesce(grp -> 'options', '[]'::jsonb)) loop
      if nullif(trim(coalesce(opt ->> 'name', '')), '') is null then
        raise exception 'An option in "%" is missing a name', trim(grp ->> 'name')
          using errcode = '22023';
      end if;
      insert into public.modifier_options
        (restaurant_id, group_id, name, name_i18n, price_cents, is_available, is_default, sort_order)
      values (
        rid,
        grp_id,
        trim(opt ->> 'name'),
        coalesce(opt -> 'name_i18n', '{}'::jsonb),
        greatest(coalesce((opt ->> 'price_cents')::int, 0), 0),
        coalesce((opt ->> 'is_available')::boolean, true),
        coalesce((opt ->> 'is_default')::boolean, false) and grp_kind = 'variant',
        o_idx
      );
      n_options := n_options + 1;
      n_in_group := n_in_group + 1;
      o_idx := o_idx + 1;
    end loop;

    if grp_kind = 'variant' and n_in_group = 0 then
      raise exception 'Variant group "%" needs at least one option', trim(grp ->> 'name')
        using errcode = '22023';
    end if;
  end loop;

  return n_options;
end;
$$;

revoke all on function public.insert_dish_modifiers(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_dish_modifiers() now delegates to the helper.
-- ---------------------------------------------------------------------------
create or replace function public.set_dish_modifiers(p_dish_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rid       uuid;
  n_options int;
begin
  select restaurant_id into rid from public.dishes where id = p_dish_id;
  if rid is null then
    raise exception 'Dish % not found', p_dish_id using errcode = '22023';
  end if;
  if not public.has_role(rid, array['owner', 'manager']) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(payload, '[]'::jsonb)) <> 'array' then
    raise exception 'payload must be an array' using errcode = '22023';
  end if;

  delete from public.modifier_groups where dish_id = p_dish_id;
  n_options := public.insert_dish_modifiers(rid, p_dish_id, coalesce(payload, '[]'::jsonb));

  return jsonb_build_object(
    'groups', jsonb_array_length(coalesce(payload, '[]'::jsonb)),
    'options', n_options
  );
end;
$$;

revoke all on function public.set_dish_modifiers(uuid, jsonb) from public, anon;
grant execute on function public.set_dish_modifiers(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- import_menu() with schedules, special dates and modifiers.
-- ---------------------------------------------------------------------------
create or replace function public.import_menu(rid uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cat         jsonb;
  dish        jsonb;
  new_cat_id  uuid;
  new_dish_id uuid;
  sched_id    uuid;
  cat_idx     int := 0;
  dish_idx    int;
  n_cats      int := 0;
  n_dishes    int := 0;
begin
  -- security definer bypasses RLS, so the role is checked explicitly here.
  if not public.has_role(rid, array['owner', 'manager']) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;

  -- Deleting dishes cascades to their modifier groups and options.
  delete from public.dishes where restaurant_id = rid;
  delete from public.categories where restaurant_id = rid;

  for cat in
    select value from jsonb_array_elements(coalesce(payload -> 'categories', '[]'::jsonb))
  loop
    -- A schedule is referenced by name; it must already exist for this
    -- restaurant. An unknown name leaves the category unscheduled.
    sched_id := null;
    if nullif(trim(coalesce(cat ->> 'schedule', '')), '') is not null then
      select s.id into sched_id
      from public.menu_schedules s
      where s.restaurant_id = rid
        and lower(s.name) = lower(trim(cat ->> 'schedule'))
      limit 1;
    end if;

    insert into public.categories (restaurant_id, name, name_i18n, description, sort_order, schedule_id)
    values (
      rid,
      cat ->> 'name',
      coalesce(cat -> 'name_i18n', '{}'::jsonb),
      nullif(cat ->> 'description', ''),
      cat_idx,
      sched_id
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
        is_available, is_featured, sort_order, special_from, special_until
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
        dish_idx,
        nullif(dish ->> 'special_from', '')::date,
        nullif(dish ->> 'special_until', '')::date
      )
      returning id into new_dish_id;

      perform public.insert_dish_modifiers(rid, new_dish_id, dish -> 'modifiers');

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
      is_available, is_featured, sort_order, special_from, special_until
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
      dish_idx,
      nullif(dish ->> 'special_from', '')::date,
      nullif(dish ->> 'special_until', '')::date
    )
    returning id into new_dish_id;

    perform public.insert_dish_modifiers(rid, new_dish_id, dish -> 'modifiers');

    n_dishes := n_dishes + 1;
    dish_idx := dish_idx + 1;
  end loop;

  return jsonb_build_object('categories', n_cats, 'dishes', n_dishes);
end;
$$;

revoke all on function public.import_menu(uuid, jsonb) from public, anon;
grant execute on function public.import_menu(uuid, jsonb) to authenticated;


-- ============================================================
-- 20260924001000_orders.sql
-- ============================================================
-- ============================================================================
-- Table ordering: sessions, orders, items, events, service requests.
--
-- Flow: a guest places an order from the menu (status 'placed', short code
-- shown as a QR). A waiter scans it, sets the table and approves
-- ('approved'), which attaches the order to the table's open session. The
-- billing counter settles the session, which marks its orders 'settled'.
-- Side exits: 'rejected' (waiter, from placed) and 'cancelled' (guest from
-- placed; waiter from approved). Placed orders expire after two hours.
--
-- Anonymous guests have NO direct policies on any of these tables. They act
-- through the security-definer functions at the bottom of this file, which
-- re-read prices from the menu and snapshot names and prices into the
-- order, so nothing the browser sends is ever trusted for money.
--
-- Staff-side functions (approve, take, edit, settle) land in the next
-- migration; this one is everything the guest needs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- table_sessions — one "tab" per seating: opened when the first order for a
-- table is approved (or when a waiter seats a walk-in), closed when paid.
-- A session may span several joined tables.
-- ---------------------------------------------------------------------------
create table if not exists public.table_sessions (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  status            text not null default 'open'
                    check (status in ('open', 'bill_requested', 'closed')),
  service_type      text not null default 'dine_in'
                    check (service_type in ('dine_in', 'takeaway')),
  -- For takeaway or a table-less walk-in: "Ravi, parcel".
  guest_label       text,
  opened_by         uuid references auth.users (id) on delete set null,
  opened_at         timestamptz not null default now(),
  bill_requested_at timestamptz,
  closed_at         timestamptz,
  closed_by         uuid references auth.users (id) on delete set null,
  -- Sum of approved and settled orders, kept by trigger.
  total_cents       integer not null default 0,
  payment_method    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists table_sessions_restaurant_status_idx
  on public.table_sessions (restaurant_id, status, opened_at desc);

create table if not exists public.table_session_tables (
  session_id uuid not null references public.table_sessions (id) on delete cascade,
  table_id   uuid not null references public.tables (id) on delete cascade,
  primary key (session_id, table_id)
);
create index if not exists table_session_tables_table_id_idx
  on public.table_session_tables (table_id);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  -- Six unambiguous characters, unique per restaurant; what the guest's QR
  -- carries and what a waiter can type if the camera fails.
  code            text not null,
  status          text not null default 'placed'
                  check (status in ('placed', 'approved', 'settled', 'rejected', 'cancelled')),
  source          text not null default 'customer'
                  check (source in ('customer', 'waiter')),
  service_type    text not null default 'dine_in'
                  check (service_type in ('dine_in', 'takeaway')),
  table_id        uuid references public.tables (id) on delete set null,
  session_id      uuid references public.table_sessions (id) on delete set null,
  note            text,
  -- Sum of line totals, kept by trigger.
  subtotal_cents  integer not null default 0,
  currency        text not null,
  locale          text,
  -- Anonymous per-browser key so a guest can cancel and replace their own
  -- unapproved order, and so one browser cannot queue many.
  device_key      text,
  created_by      uuid references auth.users (id) on delete set null,
  approved_by     uuid references auth.users (id) on delete set null,
  approved_at     timestamptz,
  last_edited_by  uuid references auth.users (id) on delete set null,
  last_edited_at  timestamptz,
  rejected_reason text,
  expires_at      timestamptz not null default now() + interval '2 hours',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, code)
);
create index if not exists orders_restaurant_status_idx
  on public.orders (restaurant_id, status, created_at desc);
create index if not exists orders_session_id_idx on public.orders (session_id);
create index if not exists orders_device_key_idx on public.orders (restaurant_id, device_key)
  where device_key is not null;

-- ---------------------------------------------------------------------------
-- order_items — names and prices are snapshots taken at placement.
-- ---------------------------------------------------------------------------
create table if not exists public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  dish_id          uuid references public.dishes (id) on delete set null,
  name             text not null,
  -- The chosen variant's price (or the dish price) plus every add-on.
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity         integer not null check (quantity between 1 and 99),
  line_total_cents integer generated always as (unit_price_cents * quantity) stored,
  -- {"option_id", "group", "name", "price_cents"} or null.
  variant          jsonb,
  -- [{"option_id", "group_id", "group", "name", "price_cents"}, …]
  addons           jsonb not null default '[]'::jsonb,
  note             text,
  -- Kitchen state; null while the kitchen screen is off.
  kds_status       text check (kds_status is null or kds_status in ('queued', 'preparing', 'ready', 'served')),
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists order_items_order_id_idx on public.order_items (order_id, sort_order);
create index if not exists order_items_restaurant_id_idx on public.order_items (restaurant_id);

-- ---------------------------------------------------------------------------
-- order_events — append-only audit trail. actor_id is null for guests.
-- ---------------------------------------------------------------------------
create table if not exists public.order_events (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  actor_id      uuid references auth.users (id) on delete set null,
  kind          text not null,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists order_events_order_id_idx on public.order_events (order_id, created_at);

-- ---------------------------------------------------------------------------
-- service_requests — "call waiter" / "ask for the bill" from a table QR.
-- ---------------------------------------------------------------------------
create table if not exists public.service_requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id      uuid references public.tables (id) on delete set null,
  session_id    uuid references public.table_sessions (id) on delete set null,
  kind          text not null check (kind in ('call_waiter', 'request_bill')),
  status        text not null default 'open' check (status in ('open', 'done')),
  device_key    text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users (id) on delete set null
);
create index if not exists service_requests_open_idx
  on public.service_requests (restaurant_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- rate_limit_buckets — fixed-window counters keyed by whatever the caller
-- hashes (an IP, a device). See check_rate_limit().
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limit_buckets (
  key          text primary key,
  window_start timestamptz not null,
  count        integer not null default 0
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists table_sessions_set_updated_at on public.table_sessions;
create trigger table_sessions_set_updated_at
  before update on public.table_sessions
  for each row execute function public.set_updated_at();
drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Totals are derived, never trusted from a client: items roll up into the
-- order, approved/settled orders roll up into the session.
-- ---------------------------------------------------------------------------
create or replace function public.order_items_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  oid uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders
     set subtotal_cents = coalesce((select sum(line_total_cents) from public.order_items where order_id = oid), 0)
   where id = oid;
  return null;
end;
$$;

drop trigger if exists order_items_recalc on public.order_items;
create trigger order_items_recalc
  after insert or update or delete on public.order_items
  for each row execute function public.order_items_recalc();

create or replace function public.orders_recalc_session()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
begin
  for sid in
    select distinct s from unnest(array[new.session_id, old.session_id]) as s where s is not null
  loop
    update public.table_sessions
       set total_cents = coalesce((
             select sum(subtotal_cents) from public.orders
              where session_id = sid and status in ('approved', 'settled')), 0)
     where id = sid;
  end loop;
  return null;
end;
$$;

drop trigger if exists orders_recalc_session on public.orders;
create trigger orders_recalc_session
  after insert or update of status, subtotal_cents, session_id or delete on public.orders
  for each row execute function public.orders_recalc_session();

-- ---------------------------------------------------------------------------
-- Row-Level Security. Staff read everything at their restaurant; writes go
-- through functions. Guests have no policies at all.
-- ---------------------------------------------------------------------------
alter table public.table_sessions       enable row level security;
alter table public.table_session_tables enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_events         enable row level security;
alter table public.service_requests     enable row level security;
alter table public.rate_limit_buckets   enable row level security;

drop policy if exists "table_sessions_member_read" on public.table_sessions;
create policy "table_sessions_member_read" on public.table_sessions
  for select using (public.member_role(restaurant_id) is not null);

drop policy if exists "table_session_tables_member_read" on public.table_session_tables;
create policy "table_session_tables_member_read" on public.table_session_tables
  for select using (exists (
    select 1 from public.table_sessions s
    where s.id = session_id and public.member_role(s.restaurant_id) is not null));

drop policy if exists "orders_member_read" on public.orders;
create policy "orders_member_read" on public.orders
  for select using (public.member_role(restaurant_id) is not null);

drop policy if exists "order_items_member_read" on public.order_items;
create policy "order_items_member_read" on public.order_items
  for select using (public.member_role(restaurant_id) is not null);

drop policy if exists "order_events_member_read" on public.order_events;
create policy "order_events_member_read" on public.order_events
  for select using (public.member_role(restaurant_id) is not null);

drop policy if exists "service_requests_member_read" on public.service_requests;
create policy "service_requests_member_read" on public.service_requests
  for select using (public.member_role(restaurant_id) is not null);

-- ---------------------------------------------------------------------------
-- generate_order_code(rid) — six characters from an alphabet without 0/O/1/I,
-- unique per restaurant, drawn from pgcrypto's random bytes.
-- ---------------------------------------------------------------------------
create or replace function public.generate_order_code(rid uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  bytes  bytea;
  i     int;
  tries int := 0;
begin
  loop
    bytes := gen_random_bytes(6);
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
    end loop;
    exit when not exists (
      select 1 from public.orders o where o.restaurant_id = rid and o.code = v_code
    );
    tries := tries + 1;
    if tries > 25 then
      raise exception 'Could not allocate an order code';
    end if;
  end loop;
  return v_code;
end;
$$;
revoke all on function public.generate_order_code(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- check_rate_limit(key, limit, window) — true while the key is under its
-- limit for the current window. Fixed window, one row per key. Old rows are
-- swept opportunistically so the table stays small.
-- ---------------------------------------------------------------------------
create or replace function public.check_rate_limit(p_key text, p_limit int, p_window interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 120 then
    return false;
  end if;

  insert into public.rate_limit_buckets as b (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when b.window_start < now() - p_window then 1 else b.count + 1 end,
    window_start = case when b.window_start < now() - p_window then now() else b.window_start end
  returning count into n;

  if random() < 0.01 then
    delete from public.rate_limit_buckets where window_start < now() - interval '1 day';
  end if;

  return n <= p_limit;
end;
$$;
revoke all on function public.check_rate_limit(text, int, interval) from public;
grant execute on function public.check_rate_limit(text, int, interval) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- insert_order_items(rid, order, items) — the one place order lines are
-- written. Validates every dish, variant and add-on against the live menu,
-- re-reads prices, snapshots names, and refuses with 22023 and a message
-- written for the guest. Items: [{dish_id, quantity, note,
-- variant_option_id, addon_option_ids: [..]}]. Not callable by clients.
-- ---------------------------------------------------------------------------
create or replace function public.insert_order_items(rid uuid, p_order_id uuid, p_items jsonb, p_at timestamptz default now())
returns int language plpgsql security definer set search_path = public as $$
declare
  item         jsonb;
  d            public.dishes%rowtype;
  qty          int;
  unit         int;
  variant_json jsonb;
  addons_json  jsonb;
  vopt         record;
  aopt         record;
  aid          text;
  grp          record;
  picked       int;
  idx          int := 0;
  n            int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The order has no items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many items in one order' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    select * into d from public.dishes
     where id = (item ->> 'dish_id')::uuid and restaurant_id = rid;
    if d.id is null then
      raise exception 'A dish in the order is no longer on the menu' using errcode = '22023';
    end if;
    if not d.is_available then
      raise exception '"%" is not available right now', d.name using errcode = '22023';
    end if;
    if not public.dish_special_active(d.id, p_at) then
      raise exception '"%" is not on the menu today', d.name using errcode = '22023';
    end if;
    if d.category_id is not null and not public.category_is_open(d.category_id, p_at) then
      raise exception '"%" is not being served at this time', d.name using errcode = '22023';
    end if;

    qty := coalesce((item ->> 'quantity')::int, 1);
    if qty < 1 or qty > 99 then
      raise exception 'Quantity must be between 1 and 99' using errcode = '22023';
    end if;

    unit := d.price_cents;
    variant_json := null;

    -- A variant is required when the dish has a variant group with anything
    -- available in it; otherwise the base price applies.
    if exists (
      select 1 from public.modifier_groups g
      join public.modifier_options o on o.group_id = g.id
      where g.dish_id = d.id and g.kind = 'variant' and o.is_available
    ) then
      if nullif(item ->> 'variant_option_id', '') is null then
        raise exception 'Choose a size for "%"', d.name using errcode = '22023';
      end if;
      select o.id, o.name, o.price_cents, g.name as group_name into vopt
        from public.modifier_options o
        join public.modifier_groups g on g.id = o.group_id
       where o.id = (item ->> 'variant_option_id')::uuid
         and g.dish_id = d.id and g.kind = 'variant' and o.is_available;
      if vopt.id is null then
        raise exception 'That size of "%" is not available', d.name using errcode = '22023';
      end if;
      unit := vopt.price_cents;
      variant_json := jsonb_build_object(
        'option_id', vopt.id, 'group', vopt.group_name, 'name', vopt.name, 'price_cents', vopt.price_cents);
    end if;

    -- Add-ons: each must be an available option of an addon group of this
    -- dish; duplicates collapse; every group's min/max must hold.
    addons_json := '[]'::jsonb;
    for aid in select value from jsonb_array_elements_text(coalesce(item -> 'addon_option_ids', '[]'::jsonb)) loop
      select o.id, o.name, o.price_cents, g.id as group_id, g.name as group_name into aopt
        from public.modifier_options o
        join public.modifier_groups g on g.id = o.group_id
       where o.id = aid::uuid and g.dish_id = d.id and g.kind = 'addon' and o.is_available;
      if aopt.id is null then
        raise exception 'An add-on for "%" is not available', d.name using errcode = '22023';
      end if;
      if addons_json @> jsonb_build_array(jsonb_build_object('option_id', aopt.id)) then
        continue;
      end if;
      unit := unit + aopt.price_cents;
      addons_json := addons_json || jsonb_build_object(
        'option_id', aopt.id, 'group_id', aopt.group_id, 'group', aopt.group_name,
        'name', aopt.name, 'price_cents', aopt.price_cents);
    end loop;

    for grp in
      select g.id, g.name, g.min_select, g.max_select
        from public.modifier_groups g
       where g.dish_id = d.id and g.kind = 'addon'
         and exists (select 1 from public.modifier_options o where o.group_id = g.id and o.is_available)
    loop
      select count(*) into picked
        from jsonb_array_elements(addons_json) a
       where (a.value ->> 'group_id')::uuid = grp.id;
      if picked < grp.min_select then
        raise exception 'Pick at least % from "%" for "%"', grp.min_select, grp.name, d.name
          using errcode = '22023';
      end if;
      if grp.max_select is not null and picked > grp.max_select then
        raise exception 'Pick at most % from "%" for "%"', grp.max_select, grp.name, d.name
          using errcode = '22023';
      end if;
    end loop;

    insert into public.order_items
      (order_id, restaurant_id, dish_id, name, unit_price_cents, quantity, variant, addons, note, sort_order)
    values
      (p_order_id, rid, d.id, d.name, unit, qty, variant_json, addons_json,
       nullif(left(trim(coalesce(item ->> 'note', '')), 200), ''), idx);

    idx := idx + 1;
    n := n + 1;
  end loop;

  return n;
end;
$$;
revoke all on function public.insert_order_items(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- place_order(...) — the guest's entry point. Returns {id, code}.
-- Errors carry messages meant for the guest's screen.
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_slug text, p_table_token text, p_service_type text, p_note text,
  p_items jsonb, p_device_key text, p_locale text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r      public.restaurants%rowtype;
  t      public.tables%rowtype;
  oid    uuid;
  v_code text;
  stype  text;
  n      int;
  recent int;
begin
  select * into r from public.restaurants where slug = p_slug;
  if r.id is null or not r.is_published or r.trial_ends_at <= now() or r.trial_status <> 'active' then
    raise exception 'This menu is not taking orders' using errcode = 'P0001';
  end if;
  if not r.ordering_enabled then
    raise exception 'Ordering is not available at this restaurant' using errcode = 'P0001';
  end if;
  if r.ordering_paused then
    raise exception '%', coalesce(r.pause_message, 'Ordering is paused right now. Please ask a member of staff.')
      using errcode = 'P0001';
  end if;

  stype := coalesce(nullif(p_service_type, ''), 'dine_in');
  if stype not in ('dine_in', 'takeaway') then
    raise exception 'Unknown service type' using errcode = '22023';
  end if;
  if stype = 'takeaway' and not r.allow_takeaway then
    raise exception 'Takeaway orders are not available here' using errcode = '22023';
  end if;

  -- An unknown or retired table token is not fatal: the waiter sets the table.
  if nullif(p_table_token, '') is not null then
    select * into t from public.tables
     where restaurant_id = r.id and qr_token = p_table_token and is_active;
  end if;

  -- Flood control per restaurant.
  select count(*) into recent from public.orders
   where restaurant_id = r.id and status = 'placed' and created_at > now() - interval '1 hour';
  if recent >= 200 then
    raise exception 'The restaurant is receiving too many orders right now. Please ask a member of staff.'
      using errcode = 'P0001';
  end if;

  -- One unapproved order per browser: a new one replaces the old.
  if nullif(p_device_key, '') is not null then
    update public.orders set status = 'cancelled'
     where restaurant_id = r.id and device_key = p_device_key and status = 'placed';
  end if;

  v_code := public.generate_order_code(r.id);
  insert into public.orders
    (restaurant_id, code, status, source, service_type, table_id, note, currency, locale, device_key)
  values
    (r.id, v_code, 'placed', 'customer', stype, t.id,
     nullif(left(trim(coalesce(p_note, '')), 300), ''), r.currency,
     nullif(left(p_locale, 10), ''), nullif(left(p_device_key, 80), ''))
  returning id into oid;

  n := public.insert_order_items(r.id, oid, p_items);

  insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
  values (oid, r.id, null, 'placed', jsonb_build_object('items', n, 'source', 'customer'));

  return jsonb_build_object('id', oid, 'code', v_code, 'restaurant_id', r.id, 'table_label', t.label);
end;
$$;
revoke all on function public.place_order(text, text, text, text, jsonb, text, text) from public;
grant execute on function public.place_order(text, text, text, text, jsonb, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_order_by_code(slug, code) — the guest's view of one order, or null.
-- Knowing the code is the capability. Expired unapproved orders read as gone.
-- ---------------------------------------------------------------------------
create or replace function public.get_order_by_code(p_slug text, p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id,
    'code', o.code,
    'status', o.status,
    'service_type', o.service_type,
    'table_label', t.label,
    'note', o.note,
    'subtotal_cents', o.subtotal_cents,
    'currency', o.currency,
    'created_at', o.created_at,
    'approved_at', o.approved_at,
    'expires_at', o.expires_at,
    'rejected_reason', o.rejected_reason,
    'session_status', s.status,
    'session_total_cents', s.total_cents,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'dish_id', i.dish_id, 'name', i.name, 'quantity', i.quantity,
        'unit_price_cents', i.unit_price_cents, 'line_total_cents', i.line_total_cents,
        'variant', i.variant, 'addons', i.addons, 'note', i.note
      ) order by i.sort_order), '[]'::jsonb)
      from public.order_items i where i.order_id = o.id
    )
  )
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.tables t on t.id = o.table_id
  left join public.table_sessions s on s.id = o.session_id
  where r.slug = p_slug
    and o.code = upper(trim(p_code))
    and not (o.status = 'placed' and o.expires_at < now())
$$;
revoke all on function public.get_order_by_code(text, text) from public;
grant execute on function public.get_order_by_code(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- cancel_order_by_code(slug, code, device) — a guest withdraws an order the
-- waiter has not approved yet. The device key must match when one was set.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order_by_code(p_slug text, p_code text, p_device_key text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  ord public.orders%rowtype;
begin
  select o.* into ord from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  where r.slug = p_slug and o.code = upper(trim(p_code));

  if ord.id is null or ord.status <> 'placed' then return false; end if;
  if ord.device_key is not null and ord.device_key is distinct from nullif(p_device_key, '') then
    return false;
  end if;

  update public.orders set status = 'cancelled' where id = ord.id;
  insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
  values (ord.id, ord.restaurant_id, null, 'cancelled', jsonb_build_object('by', 'guest'));
  return true;
end;
$$;
revoke all on function public.cancel_order_by_code(text, text, text) from public;
grant execute on function public.cancel_order_by_code(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_service_request(slug, table token, kind, device) — "call waiter" or
-- "ask for the bill" from a table QR. One open request of a kind per table;
-- a repeat within the window returns the existing one. Asking for the bill
-- also flags the table's open session.
-- ---------------------------------------------------------------------------
create or replace function public.create_service_request(p_slug text, p_table_token text, p_kind text, p_device_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r   public.restaurants%rowtype;
  t   public.tables%rowtype;
  sid uuid;
  rid uuid;
begin
  if p_kind not in ('call_waiter', 'request_bill') then
    raise exception 'Unknown request' using errcode = '22023';
  end if;

  select * into r from public.restaurants where slug = p_slug;
  if r.id is null or not r.is_published or r.trial_ends_at <= now() or r.trial_status <> 'active'
     or not r.ordering_enabled then
    raise exception 'This menu is not taking requests' using errcode = 'P0001';
  end if;

  select * into t from public.tables
   where restaurant_id = r.id and qr_token = nullif(p_table_token, '') and is_active;
  if t.id is null then
    raise exception 'Scan the code on your table to call a waiter' using errcode = '22023';
  end if;

  select id into rid from public.service_requests
   where restaurant_id = r.id and table_id = t.id and kind = p_kind and status = 'open'
     and created_at > now() - interval '15 minutes'
   limit 1;
  if rid is not null then
    return jsonb_build_object('id', rid, 'existing', true, 'restaurant_id', r.id, 'table_label', t.label);
  end if;

  select s.id into sid
    from public.table_sessions s
    join public.table_session_tables st on st.session_id = s.id
   where s.restaurant_id = r.id and st.table_id = t.id and s.status in ('open', 'bill_requested')
   order by s.opened_at desc limit 1;

  insert into public.service_requests (restaurant_id, table_id, session_id, kind, device_key)
  values (r.id, t.id, sid, p_kind, nullif(left(p_device_key, 80), ''))
  returning id into rid;

  if p_kind = 'request_bill' and sid is not null then
    update public.table_sessions
       set status = 'bill_requested', bill_requested_at = now()
     where id = sid and status = 'open';
  end if;

  return jsonb_build_object('id', rid, 'existing', false, 'restaurant_id', r.id, 'table_label', t.label);
end;
$$;
revoke all on function public.create_service_request(text, text, text, text) from public;
grant execute on function public.create_service_request(text, text, text, text) to anon, authenticated;


-- ============================================================
-- 20260924001100_staff_orders.sql
-- ============================================================
-- ============================================================================
-- Staff-side ordering: approve, reject, take, edit, move, seat, clear.
--
-- Every write to orders and order_items by staff goes through the functions
-- below; there are deliberately no insert/update policies on those tables,
-- so a role can only do what a function lets it. Serving roles are owner,
-- manager and waiter. Each function re-checks the role, the order's status
-- and that tables belong to the restaurant, then records an order_event.
-- ============================================================================

-- Staff at an unpublished restaurant still need to read the menu to take an
-- order; the public policies only cover published ones.
drop policy if exists "categories_member_read" on public.categories;
create policy "categories_member_read" on public.categories
  for select using (public.member_role(restaurant_id) is not null);
drop policy if exists "dishes_member_read" on public.dishes;
create policy "dishes_member_read" on public.dishes
  for select using (public.member_role(restaurant_id) is not null);
drop policy if exists "pairings_member_read" on public.dish_pairings;
create policy "pairings_member_read" on public.dish_pairings
  for select using (public.member_role(restaurant_id) is not null);

-- ---------------------------------------------------------------------------
-- session_for_tables(rid, tables, service type, guest label, actor)
-- Find the open session covering these tables, or open one, and make sure
-- every listed table is attached (joined tables). Takeaway and table-less
-- orders always get their own session. Internal.
-- ---------------------------------------------------------------------------
create or replace function public.session_for_tables(
  rid uuid, p_table_ids uuid[], p_service_type text, p_guest_label text, p_actor uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  sid   uuid;
  n_sessions int;
  label text := nullif(left(trim(coalesce(p_guest_label, '')), 80), '');
begin
  if p_service_type = 'dine_in' and coalesce(array_length(p_table_ids, 1), 0) > 0 then
    if exists (
      select 1 from unnest(p_table_ids) as t(id)
      left join public.tables tb on tb.id = t.id
      where tb.id is null or tb.restaurant_id <> rid or not tb.is_active
    ) then
      raise exception 'Unknown table' using errcode = '22023';
    end if;

    select count(distinct s.id) into n_sessions
      from public.table_sessions s
      join public.table_session_tables st on st.session_id = s.id
     where s.restaurant_id = rid
       and s.status in ('open', 'bill_requested')
       and st.table_id = any (p_table_ids);
    if n_sessions > 1 then
      raise exception 'These tables are on separate bills already; pick one of them'
        using errcode = '22023';
    end if;

    select s.id into sid
      from public.table_sessions s
      join public.table_session_tables st on st.session_id = s.id
     where s.restaurant_id = rid
       and s.status in ('open', 'bill_requested')
       and st.table_id = any (p_table_ids)
     limit 1;

    if sid is null then
      insert into public.table_sessions (restaurant_id, service_type, guest_label, opened_by)
      values (rid, 'dine_in', label, p_actor)
      returning id into sid;
    end if;

    insert into public.table_session_tables (session_id, table_id)
    select sid, t.id from unnest(p_table_ids) as t(id)
    on conflict do nothing;

    return sid;
  end if;

  insert into public.table_sessions (restaurant_id, service_type, guest_label, opened_by)
  values (rid, case when p_service_type = 'takeaway' then 'takeaway' else 'dine_in' end, label, p_actor)
  returning id into sid;
  return sid;
end;
$$;
revoke all on function public.session_for_tables(uuid, uuid[], text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- approve_order(order, tables, service type, guest label) → {session_id}
-- ---------------------------------------------------------------------------
create or replace function public.approve_order(
  p_order_id uuid, p_table_ids uuid[], p_service_type text, p_guest_label text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ord   public.orders%rowtype;
  r     public.restaurants%rowtype;
  sid   uuid;
  stype text;
begin
  select * into ord from public.orders where id = p_order_id;
  if ord.id is null then
    raise exception 'Order not found' using errcode = '22023';
  end if;
  if not public.has_role(ord.restaurant_id, array['owner', 'manager', 'waiter']) then
    raise exception 'Not authorised for restaurant %', ord.restaurant_id using errcode = '42501';
  end if;
  if ord.status <> 'placed' then
    raise exception 'This order is no longer waiting for approval' using errcode = '22023';
  end if;

  select * into r from public.restaurants where id = ord.restaurant_id;
  stype := coalesce(nullif(p_service_type, ''), ord.service_type);
  if stype not in ('dine_in', 'takeaway') then
    raise exception 'Unknown service type' using errcode = '22023';
  end if;
  if stype = 'dine_in' and coalesce(array_length(p_table_ids, 1), 0) = 0 then
    raise exception 'Pick a table before approving' using errcode = '22023';
  end if;

  sid := public.session_for_tables(ord.restaurant_id, p_table_ids, stype, p_guest_label, auth.uid());

  update public.orders
     set status       = 'approved',
         service_type = stype,
         table_id     = case when stype = 'dine_in' then p_table_ids[1] else null end,
         session_id   = sid,
         approved_by  = auth.uid(),
         approved_at  = now()
   where id = ord.id;

  if r.kds_enabled then
    update public.order_items set kds_status = 'queued' where order_id = ord.id and kds_status is null;
  end if;

  insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
  values (ord.id, ord.restaurant_id, auth.uid(), 'approved',
          jsonb_build_object('tables', to_jsonb(p_table_ids), 'session_id', sid, 'service_type', stype));

  return jsonb_build_object('session_id', sid);
end;
$$;
revoke all on function public.approve_order(uuid, uuid[], text, text) from public, anon;
grant execute on function public.approve_order(uuid, uuid[], text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- reject_order(order, reason): placed → rejected.
-- ---------------------------------------------------------------------------
create or replace function public.reject_order(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  ord public.orders%rowtype;
begin
  select * into ord from public.orders where id = p_order_id;
  if ord.id is null then raise exception 'Order not found' using errcode = '22023'; end if;
  if not public.has_role(ord.restaurant_id, array['owner', 'manager', 'waiter']) then
    raise exception 'Not authorised for restaurant %', ord.restaurant_id using errcode = '42501';
  end if;
  if ord.status <> 'placed' then
    raise exception 'Only an order waiting for approval can be rejected' using errcode = '22023';
  end if;

  update public.orders
     set status = 'rejected', rejected_reason = nullif(left(trim(coalesce(p_reason, '')), 200), '')
   where id = ord.id;
  insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
  values (ord.id, ord.restaurant_id, auth.uid(), 'rejected', jsonb_build_object('reason', p_reason));
end;
$$;
revoke all on function public.reject_order(uuid, text) from public, anon;
grant execute on function public.reject_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_cancel_order(order, reason): approved → cancelled (guest left, etc.).
-- ---------------------------------------------------------------------------
create or replace function public.staff_cancel_order(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  ord public.orders%rowtype;
begin
  select * into ord from public.orders where id = p_order_id;
  if ord.id is null then raise exception 'Order not found' using errcode = '22023'; end if;
  if not public.has_role(ord.restaurant_id, array['owner', 'manager', 'waiter']) then
    raise exception 'Not authorised for restaurant %', ord.restaurant_id using errcode = '42501';
  end if;
  if ord.status not in ('placed', 'approved') then
    raise exception 'This order can no longer be cancelled' using errcode = '22023';
  end if;

  update public.orders set status = 'cancelled' where id = ord.id;
  insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
  values (ord.id, ord.restaurant_id, auth.uid(), 'cancelled',
          jsonb_build_object('by', 'staff', 'reason', p_reason));
end;
$$;
revoke all on function public.staff_cancel_order(uuid, text) from public, anon;
grant execute on function public.staff_cancel_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_create_order(restaurant, tables, service type, guest label, note,
-- items) → {id, code, session_id}. A waiter taking the order is the
-- approval, so it is created as approved.
-- ---------------------------------------------------------------------------
create or replace function public.staff_create_order(
  p_restaurant_id uuid, p_table_ids uuid[], p_service_type text,
  p_guest_label text, p_note text, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r      public.restaurants%rowtype;
  sid    uuid;
  oid    uuid;
  v_code text;
  stype  text;
  n      int;
begin
  if not public.has_role(p_restaurant_id, array['owner', 'manager', 'waiter']) then
    raise exception 'Not authorised for restaurant %', p_restaurant_id using errcode = '42501';
  end if;
  select * into r from public.restaurants where id = p_restaurant_id;
  if not r.ordering_enabled then
    raise exception 'Table ordering is switched off for this restaurant' using errcode = 'P0001';
  end if;

  stype := coalesce(nullif(p_service_type, ''), 'dine_in');
  if stype not in ('dine_in', 'takeaway') then
    raise exception 'Unknown service type' using errcode = '22023';
  end if;
  if stype = 'dine_in' and coalesce(array_length(p_table_ids, 1), 0) = 0 then
    raise exception 'Pick a table for this order' using errcode = '22023';
  end if;

  sid    := public.session_for_tables(p_restaurant_id, p_table_ids, stype, p_guest_label, auth.uid());
  v_code := public.generate_order_code(p_restaurant_id);

  insert into public.orders
    (restaurant_id, code, status, source, service_type, table_id, session_id, note, currency,
     created_by, approved_by, approved_at)
  values
    (p_restaurant_id, v_code, 'approved', 'waiter', stype,
     case when stype = 'dine_in' then p_table_ids[1] else null end, sid,
     nullif(left(trim(coalesce(p_note, '')), 300), ''), r.currency,
     auth.uid(), auth.uid(), now())
  returning id into oid;

  n := public.insert_order_items(p_restaurant_id, oid, p_items);

  if r.kds_enabled then
    update public.order_items set kds_status = 'queued' where order_id = oid;
  end if;

  insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
  values (oid, p_restaurant_id, auth.uid(), 'placed', jsonb_build_object('items', n, 'source', 'waiter')),
         (oid, p_restaurant_id, auth.uid(), 'approved',
          jsonb_build_object('tables', to_jsonb(p_table_ids), 'session_id', sid, 'service_type', stype));

  return jsonb_build_object('id', oid, 'code', v_code, 'session_id', sid);
end;
$$;
revoke all on function public.staff_create_order(uuid, uuid[], text, text, text, jsonb) from public, anon;
grant execute on function public.staff_create_order(uuid, uuid[], text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_set_order_items(order, items): replace every line while the order
-- is placed or approved. The event keeps a before/after summary.
-- ---------------------------------------------------------------------------
create or replace function public.staff_set_order_items(p_order_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ord    public.orders%rowtype;
  r      public.restaurants%rowtype;
  before jsonb;
  n      int;
begin
  select * into ord from public.orders where id = p_order_id;
  if ord.id is null then raise exception 'Order not found' using errcode = '22023'; end if;
  if not public.has_role(ord.restaurant_id, array['owner', 'manager', 'waiter']) then
    raise exception 'Not authorised for restaurant %', ord.restaurant_id using errcode = '42501';
  end if;
  if ord.status not in ('placed', 'approved') then
    raise exception 'This order can no longer be changed' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity, 'line_total_cents', line_total_cents) order by sort_order), '[]'::jsonb)
    into before from public.order_items where order_id = ord.id;

  delete from public.order_items where order_id = ord.id;
  n := public.insert_order_items(ord.restaurant_id, ord.id, p_items);

  select * into r from public.restaurants where id = ord.restaurant_id;
  if r.kds_enabled and ord.status = 'approved' then
    update public.order_items set kds_status = 'queued' where order_id = ord.id and kds_status is null;
  end if;

  update public.orders set last_edited_by = auth.uid(), last_edited_at = now() where id = ord.id;

  insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
  values (ord.id, ord.restaurant_id, auth.uid(), 'items_changed',
          jsonb_build_object('before', before, 'after_count', n));

  return jsonb_build_object('items', n);
end;
$$;
revoke all on function public.staff_set_order_items(uuid, jsonb) from public, anon;
grant execute on function public.staff_set_order_items(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_move_order(order, tables, service type, guest label): put an
-- approved order on a different table (session).
-- ---------------------------------------------------------------------------
create or replace function public.staff_move_order(
  p_order_id uuid, p_table_ids uuid[], p_service_type text, p_guest_label text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ord   public.orders%rowtype;
  sid   uuid;
  stype text;
begin
  select * into ord from public.orders where id = p_order_id;
  if ord.id is null then raise exception 'Order not found' using errcode = '22023'; end if;
  if not public.has_role(ord.restaurant_id, array['owner', 'manager', 'waiter']) then
    raise exception 'Not authorised for restaurant %', ord.restaurant_id using errcode = '42501';
  end if;
  if ord.status <> 'approved' then
    raise exception 'Only an approved order can be moved' using errcode = '22023';
  end if;

  stype := coalesce(nullif(p_service_type, ''), ord.service_type);
  if stype = 'dine_in' and coalesce(array_length(p_table_ids, 1), 0) = 0 then
    raise exception 'Pick a table' using errcode = '22023';
  end if;

  sid := public.session_for_tables(ord.restaurant_id, p_table_ids, stype, p_guest_label, auth.uid());

  update public.orders
     set service_type = stype,
         table_id     = case when stype = 'dine_in' then p_table_ids[1] else null end,
         session_id   = sid,
         last_edited_by = auth.uid(),
         last_edited_at = now()
   where id = ord.id;

  insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
  values (ord.id, ord.restaurant_id, auth.uid(), 'table_changed',
          jsonb_build_object('from_session', ord.session_id, 'to_session', sid, 'tables', to_jsonb(p_table_ids)));

  return jsonb_build_object('session_id', sid);
end;
$$;
revoke all on function public.staff_move_order(uuid, uuid[], text, text) from public, anon;
grant execute on function public.staff_move_order(uuid, uuid[], text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- open_table_session(restaurant, tables, guest label) → session id.
-- Seat a walk-in before anything is ordered, so the board shows the table
-- as taken.
-- ---------------------------------------------------------------------------
create or replace function public.open_table_session(p_restaurant_id uuid, p_table_ids uuid[], p_guest_label text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(p_restaurant_id, array['owner', 'manager', 'waiter']) then
    raise exception 'Not authorised for restaurant %', p_restaurant_id using errcode = '42501';
  end if;
  if coalesce(array_length(p_table_ids, 1), 0) = 0 then
    raise exception 'Pick a table' using errcode = '22023';
  end if;
  return public.session_for_tables(p_restaurant_id, p_table_ids, 'dine_in', p_guest_label, auth.uid());
end;
$$;
revoke all on function public.open_table_session(uuid, uuid[], text) from public, anon;
grant execute on function public.open_table_session(uuid, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- clear_table_session(session): close a session that has nothing to pay
-- (guests left without ordering). Sessions with approved orders are settled
-- by billing instead.
-- ---------------------------------------------------------------------------
create or replace function public.clear_table_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.table_sessions%rowtype;
begin
  select * into s from public.table_sessions where id = p_session_id;
  if s.id is null then raise exception 'Session not found' using errcode = '22023'; end if;
  if not public.has_role(s.restaurant_id, array['owner', 'manager', 'waiter']) then
    raise exception 'Not authorised for restaurant %', s.restaurant_id using errcode = '42501';
  end if;
  if s.status = 'closed' then return; end if;
  if exists (select 1 from public.orders where session_id = s.id and status in ('approved', 'settled')) then
    raise exception 'This table has orders to pay; settle it at the counter' using errcode = '22023';
  end if;

  update public.table_sessions
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where id = s.id;
end;
$$;
revoke all on function public.clear_table_session(uuid) from public, anon;
grant execute on function public.clear_table_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- resolve_service_request(request): mark a call-waiter / bill request done.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_service_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
begin
  select restaurant_id into rid from public.service_requests where id = p_request_id;
  if rid is null then raise exception 'Request not found' using errcode = '22023'; end if;
  if not public.has_role(rid, array['owner', 'manager', 'cashier', 'waiter']) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;
  update public.service_requests
     set status = 'done', resolved_at = now(), resolved_by = auth.uid()
   where id = p_request_id and status = 'open';
end;
$$;
revoke all on function public.resolve_service_request(uuid) from public, anon;
grant execute on function public.resolve_service_request(uuid) to authenticated;


-- ============================================================
-- 20260924001200_push_subscriptions.sql
-- ============================================================
-- ============================================================================
-- Web Push subscriptions for staff phones.
--
-- One row per browser that opted in. The endpoint and keys are what the
-- push service needs; the restaurant is stamped so the sender can fan out
-- to everyone serving there. Rows are written by the browser's own user and
-- read by the service role when sending; a dead endpoint (404/410) is
-- deleted by the sender.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_restaurant_id_idx
  on public.push_subscriptions (restaurant_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_own" on public.push_subscriptions;
create policy "push_subscriptions_own" on public.push_subscriptions
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.member_role(restaurant_id) is not null);


-- ============================================================
-- 20260924001300_billing.sql
-- ============================================================
-- ============================================================================
-- Billing: settle a bill, undo a mistaken settlement, and Realtime.
--
-- The counter (owner, manager or cashier) settles a table session: every
-- approved order on it becomes 'settled', the session closes, and open
-- requests from that table are cleared. reopen_session() reverses a
-- settlement made by mistake. Both record order_events.
--
-- Orders, sessions and service requests are added to the Realtime
-- publication so the counter and the waiter app can refresh the moment a
-- row changes; Realtime honours RLS, so staff only ever hear about their
-- own restaurant.
-- ============================================================================

create or replace function public.settle_session(p_session_id uuid, p_payment_method text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.table_sessions%rowtype;
  n int;
begin
  select * into s from public.table_sessions where id = p_session_id;
  if s.id is null then raise exception 'Bill not found' using errcode = '22023'; end if;
  if not public.has_role(s.restaurant_id, array['owner', 'manager', 'cashier']) then
    raise exception 'Not authorised for restaurant %', s.restaurant_id using errcode = '42501';
  end if;
  if s.status = 'closed' then
    raise exception 'This bill is already settled' using errcode = '22023';
  end if;

  update public.orders set status = 'settled'
   where session_id = s.id and status = 'approved';
  get diagnostics n = row_count;

  insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
  select o.id, o.restaurant_id, auth.uid(), 'paid',
         jsonb_build_object('session_id', s.id, 'payment_method', nullif(p_payment_method, ''))
    from public.orders o
   where o.session_id = s.id and o.status = 'settled';

  update public.table_sessions
     set status = 'closed',
         closed_at = now(),
         closed_by = auth.uid(),
         payment_method = nullif(left(trim(coalesce(p_payment_method, '')), 40), '')
   where id = s.id;

  update public.service_requests
     set status = 'done', resolved_at = now(), resolved_by = auth.uid()
   where session_id = s.id and status = 'open';

  return jsonb_build_object('orders', n, 'total_cents', s.total_cents);
end;
$$;
revoke all on function public.settle_session(uuid, text) from public, anon;
grant execute on function public.settle_session(uuid, text) to authenticated;

-- Undo a settlement (wrong table, wrong amount). Owners and managers only.
create or replace function public.reopen_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.table_sessions%rowtype;
begin
  select * into s from public.table_sessions where id = p_session_id;
  if s.id is null then raise exception 'Bill not found' using errcode = '22023'; end if;
  if not public.has_role(s.restaurant_id, array['owner', 'manager']) then
    raise exception 'Not authorised for restaurant %', s.restaurant_id using errcode = '42501';
  end if;
  if s.status <> 'closed' then
    raise exception 'This bill is not settled' using errcode = '22023';
  end if;

  update public.orders set status = 'approved'
   where session_id = s.id and status = 'settled';

  insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
  select o.id, o.restaurant_id, auth.uid(), 'reopened', jsonb_build_object('session_id', s.id)
    from public.orders o
   where o.session_id = s.id and o.status = 'approved';

  update public.table_sessions
     set status = 'open', closed_at = null, closed_by = null, payment_method = null
   where id = s.id;
end;
$$;
revoke all on function public.reopen_session(uuid) from public, anon;
grant execute on function public.reopen_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime. Adding a table twice errors, so check first.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['orders', 'table_sessions', 'service_requests', 'order_items'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then
  -- No supabase_realtime publication (local Postgres without Supabase): skip.
  null;
end;
$$;


-- ============================================================
-- 20260924001400_kitchen.sql
-- ============================================================
-- ============================================================================
-- Kitchen screen: item and ticket states.
--
-- When the owner switches the kitchen screen on, every approved order's
-- items start as 'queued'. The kitchen moves them queued → preparing →
-- ready; a waiter (or the kitchen) marks them 'served'. States only move
-- forward, except that a mistaken 'ready' can go back to 'preparing'.
-- ============================================================================

-- Allowed transitions. 'served' is terminal.
create or replace function public.kds_transition_ok(p_from text, p_to text)
returns boolean language sql immutable as $$
  select case
    when p_from is null then false
    when p_from = 'queued'    then p_to in ('preparing', 'ready', 'served')
    when p_from = 'preparing' then p_to in ('ready', 'served')
    when p_from = 'ready'     then p_to in ('served', 'preparing')
    else false
  end
$$;

-- ---------------------------------------------------------------------------
-- set_item_kds_status(item, status): one line.
-- ---------------------------------------------------------------------------
create or replace function public.set_item_kds_status(p_item_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it  public.order_items%rowtype;
  r   public.restaurants%rowtype;
  o   public.orders%rowtype;
  all_ready boolean;
begin
  select * into it from public.order_items where id = p_item_id;
  if it.id is null then raise exception 'Item not found' using errcode = '22023'; end if;
  if not public.has_role(it.restaurant_id, array['owner', 'manager', 'waiter', 'kitchen']) then
    raise exception 'Not authorised for restaurant %', it.restaurant_id using errcode = '42501';
  end if;
  select * into r from public.restaurants where id = it.restaurant_id;
  if not r.kds_enabled then
    raise exception 'The kitchen screen is switched off' using errcode = 'P0001';
  end if;
  select * into o from public.orders where id = it.order_id;
  if o.status <> 'approved' then
    raise exception 'Only items on an approved order move through the kitchen' using errcode = '22023';
  end if;
  if p_status not in ('preparing', 'ready', 'served') then
    raise exception 'Unknown kitchen state' using errcode = '22023';
  end if;
  if not public.kds_transition_ok(coalesce(it.kds_status, 'queued'), p_status) then
    raise exception 'Cannot move "%" from % to %', it.name, coalesce(it.kds_status, 'queued'), p_status
      using errcode = '22023';
  end if;

  update public.order_items set kds_status = p_status where id = it.id;

  insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
  values (it.order_id, it.restaurant_id, auth.uid(), 'kds',
          jsonb_build_object('item_id', it.id, 'name', it.name, 'status', p_status));

  select bool_and(kds_status in ('ready', 'served')) into all_ready
    from public.order_items where order_id = it.order_id;

  return jsonb_build_object('order_id', it.order_id, 'order_ready', coalesce(all_ready, false));
end;
$$;
revoke all on function public.set_item_kds_status(uuid, text) from public, anon;
grant execute on function public.set_item_kds_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- set_order_kds_status(order, status): bump every line on a ticket that can
-- legally move. Lines already past the target are left alone.
-- ---------------------------------------------------------------------------
create or replace function public.set_order_kds_status(p_order_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  r public.restaurants%rowtype;
  n int;
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null then raise exception 'Order not found' using errcode = '22023'; end if;
  if not public.has_role(o.restaurant_id, array['owner', 'manager', 'waiter', 'kitchen']) then
    raise exception 'Not authorised for restaurant %', o.restaurant_id using errcode = '42501';
  end if;
  select * into r from public.restaurants where id = o.restaurant_id;
  if not r.kds_enabled then
    raise exception 'The kitchen screen is switched off' using errcode = 'P0001';
  end if;
  if o.status <> 'approved' then
    raise exception 'Only an approved order moves through the kitchen' using errcode = '22023';
  end if;
  if p_status not in ('preparing', 'ready', 'served') then
    raise exception 'Unknown kitchen state' using errcode = '22023';
  end if;

  update public.order_items
     set kds_status = p_status
   where order_id = o.id
     and public.kds_transition_ok(coalesce(kds_status, 'queued'), p_status);
  get diagnostics n = row_count;

  if n > 0 then
    insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
    values (o.id, o.restaurant_id, auth.uid(), 'kds',
            jsonb_build_object('status', p_status, 'items', n));
  end if;

  return jsonb_build_object('items', n);
end;
$$;
revoke all on function public.set_order_kds_status(uuid, text) from public, anon;
grant execute on function public.set_order_kds_status(uuid, text) to authenticated;


-- ============================================================
-- 20260924001500_maintenance.sql
-- ============================================================
-- ============================================================================
-- Housekeeping: expire stale unapproved orders and sweep rate-limit rows.
--
-- A guest who placed an order and walked away leaves a 'placed' row that
-- the waiter queue would otherwise show forever. expire_placed_orders()
-- cancels those past their expires_at with an 'expired' event. It is
-- scheduled every ten minutes with pg_cron when that extension is on
-- (Supabase → Database → Extensions → pg_cron); without it, call the
-- function from any scheduler, or rely on the queues already hiding
-- expired rows.
-- ============================================================================

create or replace function public.expire_placed_orders()
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  with expired as (
    update public.orders
       set status = 'cancelled'
     where status = 'placed' and expires_at < now()
    returning id, restaurant_id
  )
  insert into public.order_events (order_id, restaurant_id, actor_id, kind, details)
  select id, restaurant_id, null, 'expired', jsonb_build_object('by', 'system')
    from expired;
  get diagnostics n = row_count;

  delete from public.rate_limit_buckets where window_start < now() - interval '1 day';

  return n;
end;
$$;
revoke all on function public.expire_placed_orders() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Replace any earlier schedule of the same name.
    perform cron.unschedule(jobid) from cron.job where jobname = 'fast_menu_expire_placed_orders';
    perform cron.schedule('fast_menu_expire_placed_orders', '*/10 * * * *', 'select public.expire_placed_orders()');
  end if;
exception when undefined_table or undefined_function or insufficient_privilege then
  null;
end;
$$;


-- ============================================================
-- 20260924001600_default_currency_inr.sql
-- ============================================================
-- ============================================================================
-- Default new restaurants to INR.
--
-- The product's customers are Indian hotels and restaurants, so USD was the
-- wrong thing to hand a new signup. The baseline now creates the column with
-- this default; that only helps a fresh database, because `create table if
-- not exists` skips a table that already exists — hence this ALTER for
-- databases created before the change.
--
-- Deliberately NOT a backfill: an existing restaurant's prices were entered
-- as amounts in whatever currency it already had. Rewriting the currency code
-- would relabel every price without converting it (a 12.00 dish silently
-- becoming ₹12.00), so owners change theirs in Settings when they mean to.
-- ============================================================================

alter table public.restaurants
  alter column currency set default 'INR';


-- ============================================================
-- 20260924001700_default_timezone_kolkata.sql
-- ============================================================
-- ============================================================================
-- Default new restaurants to Asia/Kolkata.
--
-- Companion to the currency change: the customers are Indian hotels, so UTC
-- was the wrong starting point for the zone that schedules, specials and
-- reports are evaluated in. 20260924000100 now creates the column with this
-- default, which covers any database that has not run it yet; this ALTER
-- covers one that already has, since `add column if not exists` skips a
-- column that is already there.
--
-- Existing rows are left alone. A restaurant that has deliberately set its
-- own zone must keep it, and one still sitting on the old 'UTC' default is
-- changed by its owner in Settings — silently moving a live menu's opening
-- hours by five and a half hours is not something to do behind their back.
-- ============================================================================

alter table public.restaurants
  alter column timezone set default 'Asia/Kolkata';


-- ============================================================
-- 20260924001800_import_menu_settings.sql
-- ============================================================
-- ============================================================================
-- import_menu(): also carry restaurant settings and schedule definitions.
--
-- Before this, a menu file held only categories and dishes, and a category's
-- "schedule" had to match a schedule that already existed — so exporting a
-- menu and importing it into a fresh restaurant silently dropped every
-- schedule link, and nothing restored the currency, languages, timezone or
-- ordering switches.
--
-- Settings are an allowlist (see the comment in the body). Schedules are
-- matched by name and upserted, never deleted.
-- ============================================================================

create or replace function public.import_menu(rid uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cat         jsonb;
  dish        jsonb;
  new_cat_id  uuid;
  new_dish_id uuid;
  sched_id    uuid;
  sch         jsonb;
  st          jsonb;
  cat_idx     int := 0;
  n_scheds    int := 0;
  dish_idx    int;
  n_cats      int := 0;
  n_dishes    int := 0;
begin
  -- security definer bypasses RLS, so the role is checked explicitly here.
  if not public.has_role(rid, array['owner', 'manager']) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;

  -- ---------------------------------------------------------------------
  -- Restaurant settings. Only the keys present in the file are touched, so a
  -- partial block is a partial update. The column list is an allowlist that
  -- mirrors the one in menu-import.ts: slug, is_published, owner_id, trial and
  -- billing columns are absent on purpose, because an uploaded file must not
  -- be able to move a menu's public URL, publish it, or change who pays.
  -- ---------------------------------------------------------------------
  st := payload -> 'settings';
  if st is not null and jsonb_typeof(st) = 'object' then
    update public.restaurants r set
      currency          = coalesce(st ->> 'currency', r.currency),
      default_locale    = coalesce(st ->> 'default_locale', r.default_locale),
      -- An empty array would leave the menu with no language at all.
      locales           = case
                            when st ? 'locales'
                             and jsonb_array_length(st -> 'locales') > 0
                            then array(select jsonb_array_elements_text(st -> 'locales'))
                            else r.locales
                          end,
      timezone          = coalesce(st ->> 'timezone', r.timezone),
      ordering_enabled  = coalesce((st ->> 'ordering_enabled')::boolean, r.ordering_enabled),
      allow_takeaway    = coalesce((st ->> 'allow_takeaway')::boolean, r.allow_takeaway),
      table_qr_enabled  = coalesce((st ->> 'table_qr_enabled')::boolean, r.table_qr_enabled),
      kds_enabled       = coalesce((st ->> 'kds_enabled')::boolean, r.kds_enabled),
      -- Explicit null clears the link, so test for the key, not the value.
      google_review_url = case
                            when st ? 'google_review_url'
                            then nullif(st ->> 'google_review_url', '')
                            else r.google_review_url
                          end,
      updated_at        = now()
    where r.id = rid;
  end if;

  -- ---------------------------------------------------------------------
  -- Schedules, matched by name so re-importing the same file updates the
  -- window instead of piling up duplicates. Schedules the file omits are
  -- left alone rather than deleted: categories outside this import may
  -- still point at them, and the file names them rather than owning them.
  -- ---------------------------------------------------------------------
  for sch in
    select value from jsonb_array_elements(coalesce(payload -> 'schedules', '[]'::jsonb))
  loop
    select s.id into sched_id
    from public.menu_schedules s
    where s.restaurant_id = rid
      and lower(s.name) = lower(trim(sch ->> 'name'))
    limit 1;

    if sched_id is null then
      insert into public.menu_schedules (restaurant_id, name, days, starts_at, ends_at, is_active)
      values (
        rid,
        trim(sch ->> 'name'),
        array(select jsonb_array_elements_text(coalesce(sch -> 'days', '[]'::jsonb)))::smallint[],
        (sch ->> 'starts_at')::time,
        (sch ->> 'ends_at')::time,
        coalesce((sch ->> 'is_active')::boolean, true)
      );
    else
      update public.menu_schedules set
        days       = array(select jsonb_array_elements_text(coalesce(sch -> 'days', '[]'::jsonb)))::smallint[],
        starts_at  = (sch ->> 'starts_at')::time,
        ends_at    = (sch ->> 'ends_at')::time,
        is_active  = coalesce((sch ->> 'is_active')::boolean, true),
        updated_at = now()
      where id = sched_id;
    end if;

    n_scheds := n_scheds + 1;
  end loop;

  -- Deleting dishes cascades to their modifier groups and options.
  delete from public.dishes where restaurant_id = rid;
  delete from public.categories where restaurant_id = rid;

  for cat in
    select value from jsonb_array_elements(coalesce(payload -> 'categories', '[]'::jsonb))
  loop
    -- A schedule is referenced by name; it must already exist for this
    -- restaurant. An unknown name leaves the category unscheduled.
    sched_id := null;
    if nullif(trim(coalesce(cat ->> 'schedule', '')), '') is not null then
      select s.id into sched_id
      from public.menu_schedules s
      where s.restaurant_id = rid
        and lower(s.name) = lower(trim(cat ->> 'schedule'))
      limit 1;
    end if;

    insert into public.categories (restaurant_id, name, name_i18n, description, sort_order, schedule_id)
    values (
      rid,
      cat ->> 'name',
      coalesce(cat -> 'name_i18n', '{}'::jsonb),
      nullif(cat ->> 'description', ''),
      cat_idx,
      sched_id
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
        is_available, is_featured, sort_order, special_from, special_until
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
        dish_idx,
        nullif(dish ->> 'special_from', '')::date,
        nullif(dish ->> 'special_until', '')::date
      )
      returning id into new_dish_id;

      perform public.insert_dish_modifiers(rid, new_dish_id, dish -> 'modifiers');

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
      is_available, is_featured, sort_order, special_from, special_until
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
      dish_idx,
      nullif(dish ->> 'special_from', '')::date,
      nullif(dish ->> 'special_until', '')::date
    )
    returning id into new_dish_id;

    perform public.insert_dish_modifiers(rid, new_dish_id, dish -> 'modifiers');

    n_dishes := n_dishes + 1;
    dish_idx := dish_idx + 1;
  end loop;

  return jsonb_build_object('categories', n_cats, 'dishes', n_dishes, 'schedules', n_scheds);
end;
$$;

revoke all on function public.import_menu(uuid, jsonb) from public, anon;
grant execute on function public.import_menu(uuid, jsonb) to authenticated;


