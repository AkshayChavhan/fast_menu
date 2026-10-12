-- ============================================================================
-- Insights: what a restaurant's own orders say about its last thirty days.
--
-- The billing counter answers "what is open, and what did we take today".
-- This answers what an owner asks at the end of the week: is it better than
-- last week, when are we busy, what sells and what does not.
--
-- One function, one round trip, one jsonb document. Everything is bucketed by
-- the restaurant's own calendar — a bill settled at 00:30 belongs to the day it
-- is on the wall clock there, the same rule the billing counter uses for
-- "today" — and done here rather than in the page, because a busy restaurant
-- has more order lines in a month than a page should fetch to count them.
--
-- "Sales" are settled bills by the day they were paid. "Orders" are orders a
-- member of staff accepted, by the time they were placed. A placed order
-- nobody approved, a rejected one and a cancelled one are not business.
--
-- Read by the roles that hold reports:view in lib/permissions.ts.
-- ============================================================================

create or replace function public.restaurant_insights(rid uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  tz        text;
  today     date;
  since     timestamptz;  -- local midnight thirty days back, today included
  since_4w  timestamptz;  -- four whole weeks, so every weekday is counted four times
  result    jsonb;
begin
  if not public.has_role(rid, array['owner', 'manager', 'cashier']) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;

  -- A zone Postgres does not know would raise on every line below. Settings
  -- validates it, but a bad value should cost the owner an offset, not the page.
  select coalesce((select n.name from pg_timezone_names n where n.name = r.timezone), 'UTC')
    into tz
    from public.restaurants r
   where r.id = rid;
  if tz is null then
    raise exception 'Unknown restaurant %', rid using errcode = '22023';
  end if;

  today    := (now() at time zone tz)::date;
  since    := (today - 29)::timestamp at time zone tz;
  since_4w := (today - 27)::timestamp at time zone tz;

  select jsonb_build_object(
    'timezone', tz,
    'today', today,

    -- Thirty rows, oldest first, with zeros for the days nothing happened: a
    -- closed Monday is a fact about the restaurant, not a gap in the data.
    'days', (
      select jsonb_agg(jsonb_build_object(
               'date', d.day,
               'sales_cents', coalesce(s.sales_cents, 0),
               'bills', coalesce(s.bills, 0),
               'orders', coalesce(o.orders, 0)
             ) order by d.day)
        from (select today - n as day from generate_series(0, 29) as n) d
        left join (
          select (x.closed_at at time zone tz)::date as day,
                 sum(x.total_cents)::bigint as sales_cents,
                 count(*)::int as bills
            from public.table_sessions x
           where x.restaurant_id = rid and x.status = 'closed' and x.closed_at >= since
           group by 1
        ) s on s.day = d.day
        left join (
          select (x.created_at at time zone tz)::date as day, count(*)::int as orders
            from public.orders x
           where x.restaurant_id = rid and x.status in ('approved', 'settled')
             and x.created_at >= since
           group by 1
        ) o on o.day = d.day
    ),

    -- Orders by the hour they were placed, 0 to 23, over the thirty days.
    'hours', (
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'orders', coalesce(o.orders, 0))
                       order by h.hour)
        from generate_series(0, 23) as h(hour)
        left join (
          select extract(hour from x.created_at at time zone tz)::int as hour,
                 count(*)::int as orders
            from public.orders x
           where x.restaurant_id = rid and x.status in ('approved', 'settled')
             and x.created_at >= since
           group by 1
        ) o on o.hour = h.hour
    ),

    -- Monday = 1 … Sunday = 7, over four whole weeks.
    'weekdays', (
      select jsonb_agg(jsonb_build_object(
               'dow', w.dow,
               'orders', coalesce(o.orders, 0),
               'sales_cents', coalesce(s.sales_cents, 0)
             ) order by w.dow)
        from generate_series(1, 7) as w(dow)
        left join (
          select extract(isodow from x.created_at at time zone tz)::int as dow,
                 count(*)::int as orders
            from public.orders x
           where x.restaurant_id = rid and x.status in ('approved', 'settled')
             and x.created_at >= since_4w
           group by 1
        ) o on o.dow = w.dow
        left join (
          select extract(isodow from x.closed_at at time zone tz)::int as dow,
                 sum(x.total_cents)::bigint as sales_cents
            from public.table_sessions x
           where x.restaurant_id = rid and x.status = 'closed' and x.closed_at >= since_4w
           group by 1
        ) s on s.dow = w.dow
    ),

    -- Best sellers by plates sold. Grouped by the dish, not by the name on the
    -- order line, so a renamed dish is one row under the name it has today; a
    -- dish since deleted keeps the name it was sold under.
    'top_dishes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', t.name, 'quantity', t.quantity, 'revenue_cents', t.revenue_cents
             ) order by t.quantity desc, t.revenue_cents desc, t.name), '[]'::jsonb)
        from (
          select coalesce(max(d.name), max(i.name)) as name,
                 sum(i.quantity)::int as quantity,
                 sum(i.line_total_cents)::bigint as revenue_cents
            from public.order_items i
            join public.orders x on x.id = i.order_id
            left join public.dishes d on d.id = i.dish_id
           where x.restaurant_id = rid and x.status in ('approved', 'settled')
             and x.created_at >= since
           group by coalesce(i.dish_id::text, 'name:' || i.name)
           order by 2 desc, 3 desc, 1
           limit 10
        ) t
    ),

    -- Dishes that were on the menu for the whole thirty days, can be ordered
    -- now, and were not ordered once. A dish added last week has not had its
    -- chance yet and is left out.
    'unsold', (
      select jsonb_build_object(
               'count', count(*)::int,
               'names', coalesce(jsonb_agg(u.name order by u.name) filter (where u.rn <= 12),
                                 '[]'::jsonb))
        from (
          select d.name, row_number() over (order by d.name) as rn
            from public.dishes d
           where d.restaurant_id = rid and d.is_available and d.created_at <= since
             and not exists (
               select 1
                 from public.order_items i
                 join public.orders x on x.id = i.order_id
                where i.dish_id = d.id and x.status in ('approved', 'settled')
                  and x.created_at >= since)
        ) u
    ),

    -- Add-ons by how many plates carried them.
    'addons', (
      select coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'count', a.n)
                                order by a.n desc, a.name), '[]'::jsonb)
        from (
          select ad ->> 'name' as name, sum(i.quantity)::int as n
            from public.order_items i
            join public.orders x on x.id = i.order_id
           cross join lateral jsonb_array_elements(
                   case when jsonb_typeof(i.addons) = 'array' then i.addons else '[]'::jsonb end
                 ) as ad
           where x.restaurant_id = rid and x.status in ('approved', 'settled')
             and x.created_at >= since
             and coalesce(ad ->> 'name', '') <> ''
           group by 1
           order by 2 desc, 1
           limit 5
        ) a
    ),

    -- Who places the orders, and where they are eaten.
    'mix', (
      select jsonb_build_object(
               'guest',    count(*) filter (where x.source = 'customer'),
               'waiter',   count(*) filter (where x.source = 'waiter'),
               'dine_in',  count(*) filter (where x.service_type = 'dine_in'),
               'takeaway', count(*) filter (where x.service_type = 'takeaway'))
        from public.orders x
       where x.restaurant_id = rid and x.status in ('approved', 'settled')
         and x.created_at >= since
    ),

    -- The floor, this minute.
    'floor', jsonb_build_object(
      'tables_total', (
        select count(*)::int from public.tables t
         where t.restaurant_id = rid and t.is_active),
      'tables_occupied', (
        select count(distinct st.table_id)::int
          from public.table_session_tables st
          join public.table_sessions x on x.id = st.session_id
         where x.restaurant_id = rid and x.status in ('open', 'bill_requested')),
      'open_bills', (
        select count(*)::int from public.table_sessions x
         where x.restaurant_id = rid and x.status in ('open', 'bill_requested')),
      'open_cents', (
        select coalesce(sum(x.total_cents), 0)::bigint from public.table_sessions x
         where x.restaurant_id = rid and x.status in ('open', 'bill_requested'))
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.restaurant_insights(uuid) from public, anon;
grant execute on function public.restaurant_insights(uuid) to authenticated;
