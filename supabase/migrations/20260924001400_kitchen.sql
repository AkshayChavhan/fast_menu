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
