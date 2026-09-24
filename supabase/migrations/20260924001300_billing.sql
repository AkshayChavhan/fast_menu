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
