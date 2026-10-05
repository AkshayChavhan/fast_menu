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
