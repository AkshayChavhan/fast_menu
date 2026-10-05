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
