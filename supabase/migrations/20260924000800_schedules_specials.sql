-- ============================================================================
-- Menu schedules and daily specials.
--
-- A schedule is a weekly window ("Breakfast: Mon–Sun 07:00–11:00") in the
-- restaurant's own timezone. A category may point at one schedule; outside
-- the window the category is hidden from the public menu and its dishes
-- cannot be ordered. Windows may cross midnight (22:00–02:00).
--
-- A special is a dish with a date window (special_from / special_until, in
-- the restaurant's local calendar). Inside the window it is highlighted
-- under "Today's specials"; outside it is hidden and cannot be ordered. A
-- dish with no dates is an ordinary dish.
-- ============================================================================

create table if not exists public.menu_schedules (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null,
  -- 0 = Sunday … 6 = Saturday, matching extract(dow …).
  days          smallint[] not null default '{0,1,2,3,4,5,6}',
  starts_at     time not null,
  ends_at       time not null,
  -- An inactive schedule stops restricting; its categories show all day.
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists menu_schedules_restaurant_id_idx
  on public.menu_schedules (restaurant_id);

drop trigger if exists menu_schedules_set_updated_at on public.menu_schedules;
create trigger menu_schedules_set_updated_at
  before update on public.menu_schedules
  for each row execute function public.set_updated_at();

alter table public.categories
  add column if not exists schedule_id uuid references public.menu_schedules (id) on delete set null;
create index if not exists categories_schedule_id_idx on public.categories (schedule_id);

alter table public.dishes
  add column if not exists special_from  date,
  add column if not exists special_until date;

alter table public.menu_schedules enable row level security;

drop policy if exists "menu_schedules_manage_all" on public.menu_schedules;
create policy "menu_schedules_manage_all" on public.menu_schedules
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));
drop policy if exists "menu_schedules_member_read" on public.menu_schedules;
create policy "menu_schedules_member_read" on public.menu_schedules
  for select using (public.member_role(restaurant_id) is not null);
drop policy if exists "menu_schedules_public_read" on public.menu_schedules;
create policy "menu_schedules_public_read" on public.menu_schedules
  for select using (public.restaurant_is_published(restaurant_id));

-- ---------------------------------------------------------------------------
-- Is a schedule open at `at`, in its restaurant's timezone? Missing or
-- inactive schedules are "open" (they do not restrict). Overnight windows
-- count the window's start day: 22:00–02:00 on {Fri} covers Fri 22:00 to
-- Sat 02:00.
-- ---------------------------------------------------------------------------
create or replace function public.schedule_is_open(sid uuid, at timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s        public.menu_schedules%rowtype;
  tz       text;
  local_ts timestamp;
  d        int;
  prev_d   int;
  t        time;
begin
  if sid is null then return true; end if;
  select * into s from public.menu_schedules where id = sid;
  if s.id is null or not s.is_active then return true; end if;

  select timezone into tz from public.restaurants where id = s.restaurant_id;
  local_ts := at at time zone coalesce(tz, 'UTC');
  d := extract(dow from local_ts)::int;
  prev_d := (d + 6) % 7;
  t := local_ts::time;

  if s.starts_at <= s.ends_at then
    return d = any (s.days) and t >= s.starts_at and t < s.ends_at;
  end if;
  return (d = any (s.days) and t >= s.starts_at)
      or (prev_d = any (s.days) and t < s.ends_at);
end;
$$;

-- A category with no schedule is always open.
create or replace function public.category_is_open(cid uuid, at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.schedule_is_open(c.schedule_id, at) from public.categories c where c.id = cid),
    true
  )
$$;

-- A dish outside its special window is off the menu; no window means always.
create or replace function public.dish_special_active(did uuid, at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (d.special_from is null or d.special_from <= (at at time zone r.timezone)::date)
       and (d.special_until is null or d.special_until >= (at at time zone r.timezone)::date)
    from public.dishes d
    join public.restaurants r on r.id = d.restaurant_id
    where d.id = did
  ), true)
$$;
