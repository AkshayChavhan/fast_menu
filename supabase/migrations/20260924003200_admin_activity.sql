-- ============================================================================
-- Platform-admin view of who is actually using the product.
--
-- list_restaurant_plans() answers "what are they paying for". This answers the
-- question sales asks next: is the restaurant set up, and is anyone ordering.
-- One row per restaurant, with the raw facts — counts and timestamps — and no
-- verdicts. "Active", "quiet" and "at risk" are decided in lib/admin-activity.ts
-- so the thresholds can be tuned and unit-tested without a migration.
--
-- Orders are counted, never summed. A restaurant's takings are its own
-- business; an order count is enough to tell a busy floor from a dead one.
-- The only money here is what the restaurant paid us.
-- ============================================================================

create or replace function public.list_restaurant_activity()
returns table (
  restaurant_id         uuid,
  name                  text,
  slug                  text,
  city                  text,
  phone                 text,
  owner_email           text,
  created_at            timestamptz,
  plan                  text,
  plan_expires_at       timestamptz,
  effective_plan        text,
  is_live               boolean,
  is_published          boolean,
  trial_status          text,
  trial_ends_at         timestamptz,
  ordering_enabled      boolean,
  kds_enabled           boolean,
  has_review_link       boolean,
  dish_count            int,
  dish_photo_count      int,
  table_count           int,
  staff_count           int,
  last_menu_edit_at     timestamptz,
  orders_7d             int,
  orders_prev_7d        int,
  orders_30d            int,
  guest_orders_30d      int,
  last_order_at         timestamptz,
  last_payment_status   text,
  last_payment_at       timestamptz,
  paid_this_month_paise bigint
)
language sql security definer stable set search_path = public as $$
  select
    r.id, r.name, r.slug, r.city, r.phone, u.email::text, r.created_at,
    r.plan, r.plan_expires_at,
    public.restaurant_plan(r.id),
    public.restaurant_is_live(r.id),
    r.is_published, r.trial_status, r.trial_ends_at,
    r.ordering_enabled, r.kds_enabled,
    coalesce(r.google_review_url, '') <> '',
    d.dish_count, d.dish_photo_count, t.table_count, s.staff_count,
    d.last_menu_edit_at,
    o.orders_7d, o.orders_prev_7d, o.orders_30d, o.guest_orders_30d,
    o.last_order_at,
    lp.status, lp.created_at,
    pm.paid_this_month_paise
  from public.restaurants r
  -- Left join: a restaurant must not vanish from the operator's view because
  -- its owner row is unreadable.
  left join auth.users u on u.id = r.owner_id
  left join lateral (
    select count(*)::int as dish_count,
           count(*) filter (where coalesce(x.image_url, '') <> '')::int as dish_photo_count,
           max(greatest(x.created_at, x.updated_at)) as last_menu_edit_at
      from public.dishes x
     where x.restaurant_id = r.id
  ) d on true
  left join lateral (
    select count(*)::int as table_count
      from public.tables x
     where x.restaurant_id = r.id and x.is_active
  ) t on true
  left join lateral (
    select count(*)::int as staff_count
      from public.restaurant_staff x
     where x.restaurant_id = r.id and x.is_active
  ) s on true
  -- Only orders a member of staff accepted. A placed order nobody approved is
  -- a guest tapping a button, not the restaurant using the product.
  left join lateral (
    select count(*) filter (where x.created_at > now() - interval '7 days')::int as orders_7d,
           count(*) filter (where x.created_at <= now() - interval '7 days'
                              and x.created_at > now() - interval '14 days')::int as orders_prev_7d,
           count(*) filter (where x.created_at > now() - interval '30 days')::int as orders_30d,
           count(*) filter (where x.created_at > now() - interval '30 days'
                              and x.source = 'customer')::int as guest_orders_30d,
           max(x.created_at) as last_order_at
      from public.orders x
     where x.restaurant_id = r.id
       and x.status in ('approved', 'settled')
  ) o on true
  left join lateral (
    select x.status, x.created_at
      from public.payments x
     where x.restaurant_id = r.id
     order by x.created_at desc
     limit 1
  ) lp on true
  -- "This month" by the Indian calendar, which is where the invoices are.
  left join lateral (
    select coalesce(sum(x.amount_paise), 0)::bigint as paid_this_month_paise
      from public.payments x
     where x.restaurant_id = r.id
       and x.status = 'paid'
       and x.paid_at >= date_trunc('month', now() at time zone 'Asia/Kolkata')
                        at time zone 'Asia/Kolkata'
  ) pm on true
  where public.is_platform_admin()
  order by r.created_at desc
$$;

revoke all on function public.list_restaurant_activity() from public, anon;
grant execute on function public.list_restaurant_activity() to authenticated;
