-- ============================================================================
-- Web Push subscriptions for staff phones.
--
-- One row per browser that opted in. The endpoint and keys are what the
-- push service needs; the restaurant is stamped so the sender can fan out
-- to everyone serving there. Rows are written by the browser's own user and
-- read by the service role when sending; a dead endpoint (404/410) is
-- deleted by the sender.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_restaurant_id_idx
  on public.push_subscriptions (restaurant_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_own" on public.push_subscriptions;
create policy "push_subscriptions_own" on public.push_subscriptions
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.member_role(restaurant_id) is not null);
