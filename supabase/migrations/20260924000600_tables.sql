-- ============================================================================
-- Tables — the physical tables of a restaurant.
--
-- Each table carries a stable qr_token. The per-table QR code encodes
-- /m/<slug>?t=<token>, so an owner can rename "Table 5" to "Patio 2" without
-- reprinting anything. Labels are what staff and guests see; tokens are what
-- the printed code says.
-- ============================================================================

create table if not exists public.tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  label         text not null,
  qr_token      text not null default encode(gen_random_bytes(6), 'hex'),
  capacity      integer check (capacity is null or capacity > 0),
  sort_order    integer not null default 0,
  -- Inactive tables keep their history but are hidden from staff pickers and
  -- their QR stops resolving.
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, qr_token),
  unique (restaurant_id, label)
);
create index if not exists tables_restaurant_id_idx
  on public.tables (restaurant_id, sort_order);

drop trigger if exists tables_set_updated_at on public.tables;
create trigger tables_set_updated_at
  before update on public.tables
  for each row execute function public.set_updated_at();

alter table public.tables enable row level security;

-- Owners and managers manage the floor plan.
drop policy if exists "tables_manage_all" on public.tables;
create policy "tables_manage_all" on public.tables
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));

-- Every role at the restaurant can read tables (waiter pickers, billing).
drop policy if exists "tables_member_read" on public.tables;
create policy "tables_member_read" on public.tables
  for select using (public.member_role(restaurant_id) is not null);

-- Guests resolve ?t=<token> to a label on a published menu. Only active
-- tables: a retired code should read as unknown.
drop policy if exists "tables_public_read" on public.tables;
create policy "tables_public_read" on public.tables
  for select using (is_active and public.restaurant_is_published(restaurant_id));
