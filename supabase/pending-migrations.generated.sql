-- fast_menu — migrations pending on this database, in order.
-- Generated 2026-10-05 12:59.
--
-- Your database already has the staff, tables, orders, schedules and
-- modifier migrations. Missing from here: staff photos, the image size cap,
-- the tenant-scoped storage policies, the public view, and all of the plan,
-- grace-period, admin and payments work.
--
-- Starts at 20260924001800, which is probably already applied — these files are
-- written to be re-runnable, so re-applying it closes any gap for free.
--
-- Paste the whole file into the Supabase SQL editor and Run.

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


-- ============================================================
-- 20260924001900_staff_photos.sql
-- ============================================================
-- ============================================================================
-- A profile photo for each staff member.
--
-- Shown on the roster so an owner with thirty logins can tell them apart,
-- and ready for the staff apps. The image itself goes to the public
-- menu-images bucket like dish photos and the logo, under an unguessable
-- per-restaurant path; the row keeps only the public URL. It is set by
-- whoever may manage the account (the owner for every role, a manager for
-- everyone below manager), which is exactly what staff_manage_write already
-- allows, so no new policy is needed.
-- ============================================================================

alter table public.restaurant_staff
  add column if not exists avatar_url text;


-- ============================================================
-- 20260924002000_image_size_limit.sql
-- ============================================================
-- ============================================================================
-- Cap uploads to the menu-images bucket at 1 MB and to real image types.
--
-- The upload control checks both before sending, but a bucket rule holds for
-- any request that skips the UI, and it is what keeps phone-camera originals
-- (several MB each) from filling the store. Bucket settings live in Postgres
-- on Supabase, so this is an ordinary migration; on a fresh database it runs
-- right after the baseline creates the bucket. Existing files are untouched;
-- `pnpm images:prune` lists the ones nothing references any more.
-- ============================================================================

update storage.buckets
   set file_size_limit = 1048576,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'menu-images';


-- ============================================================
-- 20260924002100_staff_no_starter_restaurant.sql
-- ============================================================
-- ============================================================================
-- Staff logins must not get a starter restaurant.
--
-- handle_new_user() skipped the restaurant when app_metadata.app_role named
-- a staff role, but the Auth server writes app_metadata only after the row
-- is inserted, so the trigger never saw it: every waiter, cashier, manager
-- and kitchen login became the owner of a pending "My Restaurant" and landed
-- in the dashboard instead of its own app. user_metadata is part of the
-- insert itself, so the hint travels there as well. The app still trusts
-- only app_metadata for the role; a self-signup that sets the hint merely
-- gets no restaurant, which harms nobody else.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base_slug text;
  final_slug text;
  n int := 0;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  if coalesce(new.raw_app_meta_data ->> 'app_role', new.raw_user_meta_data ->> 'app_role', '')
     in ('manager', 'cashier', 'waiter', 'kitchen') then
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


-- ============================================================
-- 20260924002200_functions_see_extensions.sql
-- ============================================================
-- ============================================================================
-- Let search-path-pinned functions find pgcrypto.
--
-- Supabase pre-installs pgcrypto in the "extensions" schema and puts that
-- schema on the database's default search_path. Our security-definer
-- functions pin "set search_path = public" (so a caller cannot swap in a
-- lookalike function), which also hides "extensions": gen_random_bytes() in
-- generate_order_code() and digest() in claim_trial() failed with "function
-- does not exist", so guests could not place an order and owners could not
-- activate a trial. pg_trgm is created by our own migration and so lands in
-- public, which is why similarity() kept working; list_trial_reviews() gets
-- the same path anyway in case pg_trgm was enabled from the dashboard first.
--
-- "extensions" is skipped when it does not exist, so this is harmless on a
-- plain Postgres.
-- ============================================================================

alter function public.generate_order_code(uuid)
  set search_path = public, extensions;

alter function public.claim_trial(uuid, text, text, text, text)
  set search_path = public, extensions;

alter function public.list_trial_reviews()
  set search_path = public, extensions;


-- ============================================================
-- 20260924002300_menu_images_tenant_scoped.sql
-- ============================================================
-- ============================================================================
-- Scope the menu-images write policies to the restaurant that owns the path.
--
-- The baseline let any signed-in user insert, update or delete any object in
-- the bucket: the policies were "to authenticated" with only
-- bucket_id = 'menu-images' to check. Sign-up is open and object paths are
-- public (they are the image URLs on every published menu, and the bucket's
-- select policy lets anyone list it), so one account could wipe or replace
-- every other restaurant's dish photos, logo and staff avatars. The only
-- tenant check was imagePathForRestaurant() in the app's own cleanup helper,
-- which the Storage API never sees.
--
-- Every upload goes to `<restaurantId>/...` (DishForm, SettingsForm's
-- `<id>/logo`, StaffManager's `<id>/staff/...`), so the first path segment
-- names the tenant. can_manage_image() reads it back and asks has_role()
-- whether the caller is that restaurant's owner or manager, the same roles
-- that may edit the rows the images belong to. The uuid is checked before
-- the cast so a stray path is refused instead of raising. Reads stay public:
-- the bucket is public and the menu embeds these URLs.
--
-- Unlike the storage schema, the function is plain SQL, so the SQL test
-- cluster can run it (tests/menu_images.test.sql).
-- ============================================================================

create or replace function public.can_manage_image(object_name text)
returns boolean language sql stable set search_path = public as $$
  select case
    when split_part(object_name, '/', 1)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.has_role(split_part(object_name, '/', 1)::uuid, array['owner', 'manager'])
    else false
  end
$$;

grant execute on function public.can_manage_image(text) to authenticated;

drop policy if exists "menu_images_auth_write" on storage.objects;
create policy "menu_images_auth_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-images' and public.can_manage_image(name));

drop policy if exists "menu_images_auth_update" on storage.objects;
create policy "menu_images_auth_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-images' and public.can_manage_image(name))
  with check (bucket_id = 'menu-images' and public.can_manage_image(name));

drop policy if exists "menu_images_auth_delete" on storage.objects;
create policy "menu_images_auth_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu-images' and public.can_manage_image(name));


-- ============================================================
-- 20260924002400_table_token_lookup.sql
-- ============================================================
-- ============================================================================
-- Guests resolve one table token; they may not list a restaurant's tokens.
--
-- tables_public_read was a row filter, and RLS cannot see the caller's WHERE
-- or column list: with the anon key anyone could read every active table's
-- qr_token for a published restaurant and then place orders or fire
-- bill/waiter requests on any table without being there. The lookup moves
-- into a security-definer function that takes the token as input and
-- returns that one table or null. Staff keep reading tables through
-- tables_member_read; the ordering functions already take the token
-- server-side.
-- ============================================================================

create or replace function public.resolve_table_token(p_slug text, p_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object('id', t.id, 'label', t.label, 'qr_token', t.qr_token)
    from public.tables t
    join public.restaurants r on r.id = t.restaurant_id
   where r.slug = p_slug
     and r.is_published
     and r.trial_status = 'active'
     and r.trial_ends_at > now()
     and t.qr_token = p_token
     and t.is_active
   limit 1
$$;

revoke all on function public.resolve_table_token(text, text) from public;
grant execute on function public.resolve_table_token(text, text) to anon, authenticated;

drop policy if exists "tables_public_read" on public.tables;


-- ============================================================
-- 20260924002500_restaurants_public_view.sql
-- ============================================================
-- ============================================================================
-- Keep the owner's identity off the public restaurant row.
--
-- restaurants_public_read admitted every role, the anon key in the browser
-- bundle included, to any published row, and RLS filters rows, never
-- columns. *_trial_claims.sql put the OTP-verified mobile number, GSTIN,
-- city and pincode on that row, so anyone could bulk-download the phone
-- and tax registration of every live restaurant, along with its owner id
-- and trial dates.
--
-- Guests now read restaurants_public, a view of the columns a menu needs,
-- limited to published restaurants with a live trial. It runs with its
-- owner's rights (the default for a view), so the WHERE clause is the
-- gate, and the public policy on the base table is dropped: owners and
-- staff keep their own policies on the table, everyone else gets the view.
-- ============================================================================

create or replace view public.restaurants_public as
  select id, name, slug, description, logo_url, currency, default_locale, locales,
         timezone, ordering_enabled, ordering_paused, pause_message,
         table_qr_enabled, kds_enabled, allow_takeaway, google_review_url,
         created_at, updated_at
    from public.restaurants
   where is_published
     and trial_status = 'active'
     and trial_ends_at > now();

grant select on public.restaurants_public to anon, authenticated;

drop policy if exists "restaurants_public_read" on public.restaurants;


-- ============================================================
-- 20260924002600_schedule_housekeeping.sql
-- ============================================================
-- ============================================================================
-- Schedule expire_placed_orders() whenever pg_cron is present, not only when
-- it happened to be on while 20260924001500_maintenance.sql ran.
--
-- That file scheduled the job inside a one-shot block guarded by "pg_cron
-- exists". On a fresh Supabase project pg_cron is off, so the block did
-- nothing, the migration was recorded as applied, and enabling the
-- extension afterwards, as its own comment suggested, never created the
-- job. The schedule now lives in a function that can be run at any time:
--
--   select public.schedule_housekeeping();
--
-- and this migration enables pg_cron itself where the role may, reporting
-- with a notice instead of silently skipping when it may not.
-- ============================================================================

create or replace function public.schedule_housekeeping()
returns text language plpgsql security definer set search_path = public as $$
declare
  job bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return 'pg_cron is not enabled: turn it on under Database -> Extensions, then run select public.schedule_housekeeping();';
  end if;
  for job in select jobid from cron.job where jobname = 'fast_menu_expire_placed_orders' loop
    perform cron.unschedule(job);
  end loop;
  perform cron.schedule('fast_menu_expire_placed_orders', '*/10 * * * *',
                        'select public.expire_placed_orders()');
  return 'expire_placed_orders() runs every ten minutes';
end;
$$;

revoke all on function public.schedule_housekeeping() from public, anon, authenticated;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron could not be enabled from this migration (%). Enable it under Database -> Extensions, then run: select public.schedule_housekeeping();', sqlerrm;
  end;
  raise notice '%', public.schedule_housekeeping();
end;
$$;


-- ============================================================
-- 20260924002700_plans.sql
-- ============================================================
-- ============================================================================
-- Subscription plans: starter and pro.
--
-- starter (INR 2,000/yr) is the menu: QR menu, photos, allergens, variants,
-- pairings, reviews, import/export. pro (INR 5,000/yr) adds the things that
-- run a floor — table ordering, the waiter app, the kitchen screen, the
-- billing counter — plus staff logins, all languages and schedules.
--
-- The effective plan is computed, never stored: a paid plan whose
-- plan_expires_at has passed falls back to starter on its own, and a live
-- trial counts as pro so an owner can feel the ordering system before paying.
--
-- Deliberately NOT gated: settle_session and the kitchen transitions. Blocking
-- those on a downgrade would strand an unpaid bill and a half-cooked ticket in
-- the middle of service. Ordering stops at the door; what is already inside
-- gets to finish.
-- ============================================================================

alter table public.restaurants
  add column if not exists plan text not null default 'starter',
  add column if not exists plan_expires_at timestamptz;

do $plan_check$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'restaurants_plan_check'
  ) then
    alter table public.restaurants
      add constraint restaurants_plan_check check (plan in ('starter', 'pro'));
  end if;
end
$plan_check$;

-- ---------------------------------------------------------------------------
-- The plan a restaurant is actually on right now. Mirrors effectivePlan() in
-- src/lib/plans.ts — change the two together.
-- ---------------------------------------------------------------------------
create or replace function public.restaurant_plan(rid uuid)
returns text language sql security definer stable set search_path = public as $$
  select case
    -- A paid plan, still inside its term (null expiry = no end date set yet).
    when r.plan = 'pro'
     and (r.plan_expires_at is null or r.plan_expires_at > now())
      then 'pro'
    -- A live trial runs as pro. needs_review is included: publishing is
    -- blocked separately, and a hotel under review can keep building.
    when r.trial_status in ('active', 'needs_review')
     and r.trial_ends_at > now()
      then 'pro'
    else 'starter'
  end
  from public.restaurants r
  where r.id = rid
$$;

revoke all on function public.restaurant_plan(uuid) from public;
grant execute on function public.restaurant_plan(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Ordering entry points now check the plan. These are the two places an order
-- comes into being: a guest from the menu, and a waiter from the floor app.
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
  -- Plan gate. Same wording as the switched-off case: a guest should not be
  -- told about the restaurant's billing.
  if public.restaurant_plan(r.id) <> 'pro' then
    raise exception 'Ordering is not available at this restaurant' using errcode = 'P0001';
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
  -- Plan gate. Staff see the real reason, because they can act on it.
  if public.restaurant_plan(r.id) <> 'pro' then
    raise exception 'Table ordering needs the Pro plan' using errcode = 'P0001';
  end if;
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

revoke all on function public.place_order(text, text, text, text, jsonb, text, text) from public;
grant execute on function public.place_order(text, text, text, text, jsonb, text, text) to anon, authenticated;
revoke all on function public.staff_create_order(uuid, uuid[], text, text, text, jsonb) from public, anon;
grant execute on function public.staff_create_order(uuid, uuid[], text, text, text, jsonb) to authenticated;


-- ============================================================
-- 20260924002800_plan_grace.sql
-- ============================================================
-- ============================================================================
-- Separate "are they paying" from "is the menu up", with a grace period.
--
-- Before this, six places asked `trial_status = 'active' and trial_ends_at >
-- now()`. That made the trial the only thing keeping a menu alive, so a
-- customer who paid us money still went dark the day their trial lapsed — the
-- whole menu, not just ordering.
--
-- Three states now:
--
--   entitled  live trial, or a paid term that has not ended. Full plan.
--   grace     the term ended less than plan_grace() ago. The menu stays up;
--             restaurant_plan() has already dropped to starter, so ordering is
--             off. This is the important one: QR codes are printed and glued
--             to tables, and a failed card should never be a dinner-service
--             outage.
--   dark      past grace. The public surface stops resolving, as before.
--
-- plan_expires_at now means what it says: the end of a paid term, NULL for no
-- paid subscription. It no longer reads as "pro forever" — comp an account by
-- setting the date far out, the same idiom the baseline documents for
-- trial_ends_at.
-- ============================================================================

create or replace function public.plan_grace()
returns interval language sql immutable as $$
  select interval '30 days'
$$;

-- When the restaurant's current entitlement runs out: the later of a paid term
-- and the trial, so renewing moves it forward and a lapsed trial does not drag
-- a paying customer down.
create or replace function public.restaurant_is_live(rid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select r.is_published
     and now() < greatest(
           coalesce(r.plan_expires_at, '-infinity'::timestamptz),
           r.trial_ends_at
         ) + public.plan_grace()
    from public.restaurants r
   where r.id = rid
$$;

revoke all on function public.restaurant_is_live(uuid) from public;
grant execute on function public.restaurant_is_live(uuid) to anon, authenticated;

-- NULL plan_expires_at is no longer "forever".
create or replace function public.restaurant_plan(rid uuid)
returns text language sql security definer stable set search_path = public as $$
  select case
    when r.plan = 'pro' and r.plan_expires_at > now() then 'pro'
    when r.trial_status in ('active', 'needs_review')
     and r.trial_ends_at > now() then 'pro'
    else 'starter'
  end
  from public.restaurants r
  where r.id = rid
$$;

-- ---------------------------------------------------------------------------
-- The public surface: live, not "mid-trial".
-- ---------------------------------------------------------------------------

create or replace view public.restaurants_public as
  select id, name, slug, description, logo_url, currency, default_locale, locales,
         timezone, ordering_enabled, ordering_paused, pause_message,
         table_qr_enabled, kds_enabled, allow_takeaway, google_review_url,
         created_at, updated_at
    from public.restaurants
   where public.restaurant_is_live(id);

grant select on public.restaurants_public to anon, authenticated;

create or replace function public.resolve_table_token(p_slug text, p_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object('id', t.id, 'label', t.label, 'qr_token', t.qr_token)
    from public.tables t
    join public.restaurants r on r.id = t.restaurant_id
   where r.slug = p_slug
     and public.restaurant_is_live(r.id)
     and t.qr_token = p_token
     and t.is_active
   limit 1
$$;

revoke all on function public.resolve_table_token(text, text) from public;
grant execute on function public.resolve_table_token(text, text) to anon, authenticated;

create or replace function public.restaurant_accepts_reviews(rid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.restaurants r
    left join public.review_forms f on f.restaurant_id = r.id
    where r.id = rid
      and public.restaurant_is_live(r.id)
      and coalesce(f.is_enabled, true) = true
  );
$$;

-- ---------------------------------------------------------------------------
-- Publishing: a paid customer may publish without a live trial. The old guard
-- asked only about the trial, so a restaurant that had paid us money could not
-- put its own menu back up.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_trial_before_publish()
returns trigger language plpgsql as $$
begin
  if new.is_published and not old.is_published
     and new.trial_status <> 'active'
     and coalesce(new.plan_expires_at > now(), false) = false then
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
-- Ordering: live for the menu, pro for the ordering.
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
  if r.id is null or not public.restaurant_is_live(r.id) then
    raise exception 'This menu is not taking orders' using errcode = 'P0001';
  end if;
  -- Plan gate. Same wording as the switched-off case: a guest should not be
  -- told about the restaurant's billing.
  if public.restaurant_plan(r.id) <> 'pro' then
    raise exception 'Ordering is not available at this restaurant' using errcode = 'P0001';
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
  if r.id is null or not public.restaurant_is_live(r.id)
     or not r.ordering_enabled
     or public.restaurant_plan(r.id) <> 'pro' then
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

revoke all on function public.place_order(text, text, text, text, jsonb, text, text) from public;
grant execute on function public.place_order(text, text, text, text, jsonb, text, text) to anon, authenticated;
revoke all on function public.create_service_request(text, text, text, text) from public;
grant execute on function public.create_service_request(text, text, text, text) to anon, authenticated;


-- ============================================================
-- 20260924002900_admin_plans.sql
-- ============================================================
-- ============================================================================
-- Platform-admin control of subscriptions.
--
-- Until now a plan could only be changed with a hand-written UPDATE. These two
-- functions put it behind is_platform_admin(), the same gate the trial review
-- uses, so the operator page can do it and nobody else can.
--
-- Terms are set in months rather than as a timestamp: it is what an operator
-- actually knows ("they paid for a year"), and it keeps renewal arithmetic —
-- and its timezone bugs — out of the browser.
-- ============================================================================

-- Every restaurant with its subscription state, newest first. Admin only.
create or replace function public.list_restaurant_plans()
returns table (
  restaurant_id   uuid,
  name            text,
  slug            text,
  plan            text,
  plan_expires_at timestamptz,
  effective_plan  text,
  is_live         boolean,
  is_published    boolean,
  trial_status    text,
  trial_ends_at   timestamptz,
  created_at      timestamptz
)
language sql security definer stable set search_path = public as $$
  select r.id, r.name, r.slug, r.plan, r.plan_expires_at,
         public.restaurant_plan(r.id),
         public.restaurant_is_live(r.id),
         r.is_published, r.trial_status, r.trial_ends_at, r.created_at
    from public.restaurants r
   where public.is_platform_admin()
   order by r.created_at desc
$$;

revoke all on function public.list_restaurant_plans() from public, anon;
grant execute on function public.list_restaurant_plans() to authenticated;

-- Set the tier and extend the paid term.
--
--   p_months > 0  extend from whichever is later, now or the current expiry,
--                 so renewing early adds to the term instead of shortening it.
--   p_months = 0  clear the paid term. The restaurant keeps its menu for
--                 plan_grace() and loses pro at once — the downgrade path.
create or replace function public.set_restaurant_plan(
  rid uuid, p_plan text, p_months int
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  new_expiry timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Not a platform admin' using errcode = '42501';
  end if;
  if p_plan not in ('starter', 'pro') then
    raise exception 'Unknown plan %', p_plan using errcode = '22023';
  end if;
  if p_months < 0 or p_months > 120 then
    raise exception 'Term must be between 0 and 120 months' using errcode = '22023';
  end if;

  if p_months = 0 then
    new_expiry := null;
  else
    select greatest(now(), coalesce(r.plan_expires_at, now())) + (p_months || ' months')::interval
      into new_expiry
      from public.restaurants r
     where r.id = rid;
  end if;

  update public.restaurants
     set plan = p_plan, plan_expires_at = new_expiry, updated_at = now()
   where id = rid;

  if not found then
    raise exception 'Unknown restaurant %', rid using errcode = '22023';
  end if;

  return jsonb_build_object(
    'plan', p_plan,
    'plan_expires_at', new_expiry,
    'effective_plan', public.restaurant_plan(rid)
  );
end;
$$;

revoke all on function public.set_restaurant_plan(uuid, text, int) from public, anon;
grant execute on function public.set_restaurant_plan(uuid, text, int) to authenticated;


-- ============================================================
-- 20260924003000_white_label.sql
-- ============================================================
-- ============================================================================
-- Tell the public menu whether to hide the fast_menu footer.
--
-- The menu renders from restaurants_public with the anon key, so it cannot
-- compute the plan itself — the view does not expose plan, plan_expires_at or
-- the trial columns, and it should not: a guest has no business knowing what
-- their restaurant pays. The view publishes the one derived bit the page needs
-- instead, which is also what makes white-labelling enforced rather than a
-- client-side preference.
-- ============================================================================

create or replace view public.restaurants_public as
  select id, name, slug, description, logo_url, currency, default_locale, locales,
         timezone, ordering_enabled, ordering_paused, pause_message,
         table_qr_enabled, kds_enabled, allow_takeaway, google_review_url,
         created_at, updated_at,
         public.restaurant_plan(id) = 'pro' as hide_branding
    from public.restaurants
   where public.restaurant_is_live(id);

grant select on public.restaurants_public to anon, authenticated;


-- ============================================================
-- 20260924003100_payments.sql
-- ============================================================
-- ============================================================================
-- Payments: a record of money received, and the one path that turns it into a
-- subscription.
--
-- The table exists mainly for idempotency. A gateway will deliver the same
-- webhook more than once — on retry, on replay, on a dashboard "resend" — and
-- a payment that extends the term twice is a customer getting a free year.
-- provider_order_id is unique, and apply_paid_term() refuses to act on a row
-- that is already paid, so redelivery is a no-op rather than a gift.
--
-- apply_paid_term() is NOT granted to authenticated. It is the one function
-- that hands out a paid term without an admin check, so only the service role
-- may call it — from the webhook route, after the signature has been verified.
-- Granting it to logged-in users would let any owner give themselves Pro.
-- ============================================================================

create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references public.restaurants (id) on delete cascade,
  provider            text not null default 'razorpay',
  -- The gateway's order id. Unique, because it is the idempotency key.
  provider_order_id   text not null unique,
  provider_payment_id text,
  plan                text not null check (plan in ('starter', 'pro')),
  months              int  not null check (months > 0 and months <= 120),
  amount_paise        int  not null check (amount_paise >= 0),
  status              text not null default 'created'
                      check (status in ('created', 'paid', 'failed')),
  -- Who started it, for support questions. Null once the owner is deleted.
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);

create index if not exists payments_restaurant_id_idx on public.payments (restaurant_id);
create index if not exists payments_status_idx on public.payments (status);

alter table public.payments enable row level security;

-- An owner or manager may see their own restaurant's payments. Nobody writes
-- through RLS: rows are created by the order route and settled by the webhook,
-- both server-side.
drop policy if exists "payments_member_read" on public.payments;
create policy "payments_member_read" on public.payments
  for select using (public.has_role(restaurant_id, array['owner', 'manager']));

-- ---------------------------------------------------------------------------
-- Settle a payment and extend the term, once.
--
-- Returns the row's final state so the caller can tell "applied now" from
-- "already applied" without a second query. Extends from whichever is later,
-- now or the current expiry, so paying early adds time rather than discarding
-- it — the same rule set_restaurant_plan() uses.
-- ---------------------------------------------------------------------------
create or replace function public.apply_paid_term(
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_paise int
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pay public.payments%rowtype;
begin
  -- Lock the row: two webhook deliveries can arrive at the same moment.
  select * into pay from public.payments
   where provider_order_id = p_provider_order_id
   for update;

  if pay.id is null then
    raise exception 'Unknown order %', p_provider_order_id using errcode = '22023';
  end if;

  if pay.status = 'paid' then
    return jsonb_build_object('applied', false, 'reason', 'already_paid',
                              'restaurant_id', pay.restaurant_id);
  end if;

  -- The amount is checked against what we asked for, not what we were told to
  -- charge: a tampered checkout must not buy a year for one rupee.
  --
  -- Returned rather than raised, because raising would roll back the very
  -- update that records what happened — and because retrying a short payment
  -- will never make it longer, so the caller should acknowledge and alert, not
  -- loop.
  if p_amount_paise < pay.amount_paise then
    update public.payments
       set status = 'failed', provider_payment_id = p_provider_payment_id
     where id = pay.id;
    return jsonb_build_object('applied', false, 'reason', 'amount_short',
                              'restaurant_id', pay.restaurant_id,
                              'expected_paise', pay.amount_paise,
                              'received_paise', p_amount_paise);
  end if;

  update public.restaurants
     set plan = pay.plan,
         plan_expires_at = greatest(now(), coalesce(plan_expires_at, now()))
                           + (pay.months || ' months')::interval,
         updated_at = now()
   where id = pay.restaurant_id;

  update public.payments
     set status = 'paid',
         provider_payment_id = p_provider_payment_id,
         paid_at = now()
   where id = pay.id;

  return jsonb_build_object('applied', true, 'restaurant_id', pay.restaurant_id,
                            'plan', pay.plan, 'months', pay.months);
end;
$$;

-- Deliberately not granted to anon or authenticated: see the header.
revoke all on function public.apply_paid_term(text, text, int) from public, anon, authenticated;

