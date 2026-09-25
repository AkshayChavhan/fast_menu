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
