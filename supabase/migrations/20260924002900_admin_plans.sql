-- ============================================================================
-- Platform-admin control of subscriptions.
--
-- Until now a plan could only be changed with a hand-written UPDATE. These two
-- functions put it behind is_platform_admin(), the same gate the trial review
-- uses, so the operator page can do it and nobody else can.
--
-- Terms are set in months rather than as a timestamp: it is what an operator
-- actually knows ("they paid for a year"), and it keeps renewal arithmetic —
-- and its timezone bugs — out of the browser.
-- ============================================================================

-- Every restaurant with its subscription state, newest first. Admin only.
create or replace function public.list_restaurant_plans()
returns table (
  restaurant_id   uuid,
  name            text,
  slug            text,
  plan            text,
  plan_expires_at timestamptz,
  effective_plan  text,
  is_live         boolean,
  is_published    boolean,
  trial_status    text,
  trial_ends_at   timestamptz,
  created_at      timestamptz
)
language sql security definer stable set search_path = public as $$
  select r.id, r.name, r.slug, r.plan, r.plan_expires_at,
         public.restaurant_plan(r.id),
         public.restaurant_is_live(r.id),
         r.is_published, r.trial_status, r.trial_ends_at, r.created_at
    from public.restaurants r
   where public.is_platform_admin()
   order by r.created_at desc
$$;

revoke all on function public.list_restaurant_plans() from public, anon;
grant execute on function public.list_restaurant_plans() to authenticated;

-- Set the tier and extend the paid term.
--
--   p_months > 0  extend from whichever is later, now or the current expiry,
--                 so renewing early adds to the term instead of shortening it.
--   p_months = 0  clear the paid term. The restaurant keeps its menu for
--                 plan_grace() and loses pro at once — the downgrade path.
create or replace function public.set_restaurant_plan(
  rid uuid, p_plan text, p_months int
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  new_expiry timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Not a platform admin' using errcode = '42501';
  end if;
  if p_plan not in ('starter', 'pro') then
    raise exception 'Unknown plan %', p_plan using errcode = '22023';
  end if;
  if p_months < 0 or p_months > 120 then
    raise exception 'Term must be between 0 and 120 months' using errcode = '22023';
  end if;

  if p_months = 0 then
    new_expiry := null;
  else
    select greatest(now(), coalesce(r.plan_expires_at, now())) + (p_months || ' months')::interval
      into new_expiry
      from public.restaurants r
     where r.id = rid;
  end if;

  update public.restaurants
     set plan = p_plan, plan_expires_at = new_expiry, updated_at = now()
   where id = rid;

  if not found then
    raise exception 'Unknown restaurant %', rid using errcode = '22023';
  end if;

  return jsonb_build_object(
    'plan', p_plan,
    'plan_expires_at', new_expiry,
    'effective_plan', public.restaurant_plan(rid)
  );
end;
$$;

revoke all on function public.set_restaurant_plan(uuid, text, int) from public, anon;
grant execute on function public.set_restaurant_plan(uuid, text, int) to authenticated;
