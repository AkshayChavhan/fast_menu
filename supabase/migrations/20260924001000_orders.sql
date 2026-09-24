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
