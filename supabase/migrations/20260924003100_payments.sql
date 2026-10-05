-- ============================================================================
-- Payments: a record of money received, and the one path that turns it into a
-- subscription.
--
-- The table exists mainly for idempotency. A gateway will deliver the same
-- webhook more than once — on retry, on replay, on a dashboard "resend" — and
-- a payment that extends the term twice is a customer getting a free year.
-- provider_order_id is unique, and apply_paid_term() refuses to act on a row
-- that is already paid, so redelivery is a no-op rather than a gift.
--
-- apply_paid_term() is NOT granted to authenticated. It is the one function
-- that hands out a paid term without an admin check, so only the service role
-- may call it — from the webhook route, after the signature has been verified.
-- Granting it to logged-in users would let any owner give themselves Pro.
-- ============================================================================

create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references public.restaurants (id) on delete cascade,
  provider            text not null default 'razorpay',
  -- The gateway's order id. Unique, because it is the idempotency key.
  provider_order_id   text not null unique,
  provider_payment_id text,
  plan                text not null check (plan in ('starter', 'pro')),
  months              int  not null check (months > 0 and months <= 120),
  amount_paise        int  not null check (amount_paise >= 0),
  status              text not null default 'created'
                      check (status in ('created', 'paid', 'failed')),
  -- Who started it, for support questions. Null once the owner is deleted.
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);

create index if not exists payments_restaurant_id_idx on public.payments (restaurant_id);
create index if not exists payments_status_idx on public.payments (status);

alter table public.payments enable row level security;

-- An owner or manager may see their own restaurant's payments. Nobody writes
-- through RLS: rows are created by the order route and settled by the webhook,
-- both server-side.
drop policy if exists "payments_member_read" on public.payments;
create policy "payments_member_read" on public.payments
  for select using (public.has_role(restaurant_id, array['owner', 'manager']));

-- ---------------------------------------------------------------------------
-- Settle a payment and extend the term, once.
--
-- Returns the row's final state so the caller can tell "applied now" from
-- "already applied" without a second query. Extends from whichever is later,
-- now or the current expiry, so paying early adds time rather than discarding
-- it — the same rule set_restaurant_plan() uses.
-- ---------------------------------------------------------------------------
create or replace function public.apply_paid_term(
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_paise int
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pay public.payments%rowtype;
begin
  -- Lock the row: two webhook deliveries can arrive at the same moment.
  select * into pay from public.payments
   where provider_order_id = p_provider_order_id
   for update;

  if pay.id is null then
    raise exception 'Unknown order %', p_provider_order_id using errcode = '22023';
  end if;

  if pay.status = 'paid' then
    return jsonb_build_object('applied', false, 'reason', 'already_paid',
                              'restaurant_id', pay.restaurant_id);
  end if;

  -- The amount is checked against what we asked for, not what we were told to
  -- charge: a tampered checkout must not buy a year for one rupee.
  --
  -- Returned rather than raised, because raising would roll back the very
  -- update that records what happened — and because retrying a short payment
  -- will never make it longer, so the caller should acknowledge and alert, not
  -- loop.
  if p_amount_paise < pay.amount_paise then
    update public.payments
       set status = 'failed', provider_payment_id = p_provider_payment_id
     where id = pay.id;
    return jsonb_build_object('applied', false, 'reason', 'amount_short',
                              'restaurant_id', pay.restaurant_id,
                              'expected_paise', pay.amount_paise,
                              'received_paise', p_amount_paise);
  end if;

  update public.restaurants
     set plan = pay.plan,
         plan_expires_at = greatest(now(), coalesce(plan_expires_at, now()))
                           + (pay.months || ' months')::interval,
         updated_at = now()
   where id = pay.restaurant_id;

  update public.payments
     set status = 'paid',
         provider_payment_id = p_provider_payment_id,
         paid_at = now()
   where id = pay.id;

  return jsonb_build_object('applied', true, 'restaurant_id', pay.restaurant_id,
                            'plan', pay.plan, 'months', pay.months);
end;
$$;

-- Deliberately not granted to anon or authenticated: see the header.
revoke all on function public.apply_paid_term(text, text, int) from public, anon, authenticated;
