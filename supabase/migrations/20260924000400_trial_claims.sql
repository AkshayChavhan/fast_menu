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
