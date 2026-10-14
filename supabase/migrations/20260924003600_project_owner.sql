-- ============================================================================
-- Two levels of platform admin.
--
-- Until now one list, platform_admins, gated every operator page. That is
-- fine while the person who runs the company is the only name in it, and
-- wrong the day a support hire is added: they should see who needs a call,
-- not change what a restaurant pays or who else is an admin.
--
--   admin          trial review, the activity list, plans (read), leads,
--                  and the view-only restaurant page.
--   project_owner  everything an admin can, plus: set plans, see payments,
--                  add and remove admins, and read the audit log.
--
-- Whoever is already in the table becomes a project_owner: they were the
-- only operator, so they were the owner in all but name.
--
-- Every change a project owner makes is written to platform_audit. The
-- restaurants' trust in the operator rests on being able to show what was
-- touched and when.
-- ============================================================================

alter table public.platform_admins
  add column if not exists role text not null default 'admin'
  check (role in ('admin', 'project_owner'));

update public.platform_admins set role = 'project_owner'
 where role = 'admin'
   and not exists (select 1 from public.platform_admins where role = 'project_owner');

create or replace function public.is_project_owner()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.platform_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and a.role = 'project_owner'
  )
$$;

-- The signed-in user's level, or null. One call for a page to decide both
-- whether to render and which links to show.
create or replace function public.platform_admin_role()
returns text language sql security definer stable set search_path = public as $$
  select a.role from public.platform_admins a
  where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- platform_audit — what a project owner changed. Append only.
-- ---------------------------------------------------------------------------
create table if not exists public.platform_audit (
  id         uuid primary key default gen_random_uuid(),
  actor      text,                         -- email from the JWT
  action     text not null,                -- e.g. plan.set, admin.add
  target     text,                         -- restaurant id, email, ...
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_created_idx on public.platform_audit (created_at desc);
alter table public.platform_audit enable row level security;
drop policy if exists "platform_audit_owner_read" on public.platform_audit;
create policy "platform_audit_owner_read" on public.platform_audit
  for select using (public.is_project_owner());

create or replace function public.platform_audit_log(
  p_action text, p_target text, p_details jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public as $$
  insert into public.platform_audit (actor, action, target, details)
  values (auth.jwt() ->> 'email', p_action, p_target, coalesce(p_details, '{}'::jsonb))
$$;

create or replace function public.list_platform_audit(p_limit int default 100)
returns table (id uuid, actor text, action text, target text, details jsonb, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select a.id, a.actor, a.action, a.target, a.details, a.created_at
  from public.platform_audit a
  where public.is_project_owner()
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;

-- ---------------------------------------------------------------------------
-- Managing admins. Owner only; the last owner cannot be removed or demoted,
-- or the pages would lock everyone out with no way back short of the SQL
-- editor.
-- ---------------------------------------------------------------------------
create or replace function public.list_platform_admins()
returns table (email text, role text, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select a.email, a.role, a.created_at
  from public.platform_admins a
  where public.is_project_owner()
  order by a.role desc, a.created_at
$$;

create or replace function public.set_platform_admin(p_email text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  em text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_project_owner() then
    raise exception 'not the project owner' using errcode = '42501';
  end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'not an email address' using errcode = '22023';
  end if;
  if p_role not in ('admin', 'project_owner') then
    raise exception 'unknown role %', p_role using errcode = '22023';
  end if;
  if p_role = 'admin' and exists (
    select 1 from public.platform_admins a where lower(a.email) = em and a.role = 'project_owner'
  ) and (select count(*) from public.platform_admins where role = 'project_owner') = 1 then
    raise exception 'cannot demote the last project owner' using errcode = '22023';
  end if;

  insert into public.platform_admins (email, role) values (em, p_role)
  on conflict (email) do update set role = excluded.role;

  perform public.platform_audit_log('admin.set', em, jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.remove_platform_admin(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  em text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_project_owner() then
    raise exception 'not the project owner' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.platform_admins a where lower(a.email) = em and a.role = 'project_owner'
  ) and (select count(*) from public.platform_admins where role = 'project_owner') = 1 then
    raise exception 'cannot remove the last project owner' using errcode = '22023';
  end if;

  delete from public.platform_admins a where lower(a.email) = em;
  if not found then
    raise exception 'no such admin' using errcode = '22023';
  end if;

  perform public.platform_audit_log('admin.remove', em);
end;
$$;

-- ---------------------------------------------------------------------------
-- Setting a plan is money: owner only now, and audited. Same contract as
-- before otherwise (see *_admin_plans.sql).
-- ---------------------------------------------------------------------------
create or replace function public.set_restaurant_plan(
  rid uuid, p_plan text, p_months int
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  new_expiry timestamptz;
  old_plan   text;
  old_expiry timestamptz;
begin
  if not public.is_project_owner() then
    raise exception 'Only the project owner can change plans' using errcode = '42501';
  end if;
  if p_plan not in ('starter', 'pro') then
    raise exception 'Unknown plan %', p_plan using errcode = '22023';
  end if;
  if p_months < 0 or p_months > 120 then
    raise exception 'Term must be between 0 and 120 months' using errcode = '22023';
  end if;

  select r.plan, r.plan_expires_at into old_plan, old_expiry
    from public.restaurants r where r.id = rid;
  if old_plan is null then
    raise exception 'Unknown restaurant %', rid using errcode = '22023';
  end if;

  if p_months = 0 then
    new_expiry := null;
  else
    new_expiry := greatest(now(), coalesce(old_expiry, now())) + (p_months || ' months')::interval;
  end if;

  update public.restaurants
     set plan = p_plan, plan_expires_at = new_expiry, updated_at = now()
   where id = rid;

  perform public.platform_audit_log('plan.set', rid::text, jsonb_build_object(
    'from', jsonb_build_object('plan', old_plan, 'expires_at', old_expiry),
    'to',   jsonb_build_object('plan', p_plan, 'expires_at', new_expiry, 'months', p_months)
  ));

  return jsonb_build_object(
    'plan', p_plan,
    'plan_expires_at', new_expiry,
    'effective_plan', public.restaurant_plan(rid)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments: what restaurants paid us. Owner only. This is the one place
-- money appears in the operator pages, and it is our money, not theirs.
-- ---------------------------------------------------------------------------
create or replace function public.list_payments(p_limit int default 200)
returns table (
  id uuid, restaurant_id uuid, restaurant_name text, restaurant_slug text,
  provider text, provider_order_id text, provider_payment_id text,
  plan text, months int, amount_paise int, status text,
  created_at timestamptz, paid_at timestamptz
)
language sql security definer stable set search_path = public as $$
  select p.id, p.restaurant_id, r.name, r.slug,
         p.provider, p.provider_order_id, p.provider_payment_id,
         p.plan, p.months, p.amount_paise, p.status, p.created_at, p.paid_at
  from public.payments p
  join public.restaurants r on r.id = p.restaurant_id
  where public.is_project_owner()
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

-- ---------------------------------------------------------------------------
-- admin_restaurant_detail() — one restaurant, read only, for support.
-- Profile, plan, setup switches, the staff roster and the menu: what an
-- operator needs to help on a call. Deliberately absent: orders, takings,
-- guests and review text. Those are the restaurant's own business.
-- Payments are included for a project owner only.
-- ---------------------------------------------------------------------------
create or replace function public.admin_restaurant_detail(rid uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  r      public.restaurants%rowtype;
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not a platform admin' using errcode = '42501';
  end if;
  select * into r from public.restaurants where id = rid;
  if not found then
    raise exception 'Unknown restaurant %', rid using errcode = '22023';
  end if;

  result := jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', r.id, 'name', r.name, 'slug', r.slug, 'city', r.city,
      'pincode', r.pincode, 'phone', r.phone, 'gstin', r.gstin,
      'owner_email', (select u.email from auth.users u where u.id = r.owner_id),
      'currency', r.currency, 'default_locale', r.default_locale, 'locales', to_jsonb(r.locales),
      'timezone', r.timezone, 'is_published', r.is_published,
      'is_live', public.restaurant_is_live(r.id),
      'plan', r.plan, 'plan_expires_at', r.plan_expires_at,
      'effective_plan', public.restaurant_plan(r.id),
      'trial_status', r.trial_status, 'trial_ends_at', r.trial_ends_at,
      'ordering_enabled', r.ordering_enabled, 'ordering_paused', r.ordering_paused,
      'table_qr_enabled', r.table_qr_enabled, 'kds_enabled', r.kds_enabled,
      'allow_takeaway', r.allow_takeaway,
      'has_review_link', r.google_review_url is not null,
      'created_at', r.created_at, 'updated_at', r.updated_at
    ),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'display_name', s.display_name, 'email', s.email,
        'role', s.role, 'is_active', s.is_active, 'created_at', s.created_at
      ) order by s.is_active desc, s.role, s.display_name)
      from public.restaurant_staff s where s.restaurant_id = rid
    ), '[]'::jsonb),
    'menu', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name,
        'dishes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', d.id, 'name', d.name, 'price_cents', d.price_cents,
            'is_available', d.is_available, 'has_image', d.image_url is not null
          ) order by d.sort_order, d.name)
          from public.dishes d where d.category_id = c.id
        ), '[]'::jsonb)
      ) order by c.sort_order, c.name)
      from public.categories c where c.restaurant_id = rid
    ), '[]'::jsonb),
    'uncategorised_dishes', (
      select count(*) from public.dishes d
      where d.restaurant_id = rid and d.category_id is null
    )
  );

  if public.is_project_owner() then
    result := result || jsonb_build_object('payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'plan', p.plan, 'months', p.months, 'amount_paise', p.amount_paise,
        'status', p.status, 'created_at', p.created_at, 'paid_at', p.paid_at
      ) order by p.created_at desc)
      from public.payments p where p.restaurant_id = rid
    ), '[]'::jsonb));
  end if;

  return result;
end;
$$;

revoke all on function public.is_project_owner() from public, anon;
revoke all on function public.platform_admin_role() from public, anon;
revoke all on function public.platform_audit_log(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.list_platform_audit(int) from public, anon;
revoke all on function public.list_platform_admins() from public, anon;
revoke all on function public.set_platform_admin(text, text) from public, anon;
revoke all on function public.remove_platform_admin(text) from public, anon;
revoke all on function public.list_payments(int) from public, anon;
revoke all on function public.admin_restaurant_detail(uuid) from public, anon;
grant execute on function public.is_project_owner() to authenticated;
grant execute on function public.platform_admin_role() to authenticated;
grant execute on function public.list_platform_audit(int) to authenticated;
grant execute on function public.list_platform_admins() to authenticated;
grant execute on function public.set_platform_admin(text, text) to authenticated;
grant execute on function public.remove_platform_admin(text) to authenticated;
grant execute on function public.list_payments(int) to authenticated;
grant execute on function public.admin_restaurant_detail(uuid) to authenticated;
