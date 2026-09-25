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
