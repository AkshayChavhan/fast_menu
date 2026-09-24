-- ============================================================================
-- Variants and add-ons ("modifiers") on a dish.
--
-- A dish may carry any number of modifier groups, each of one kind:
--   variant — the guest picks exactly one option (Half / Full, Small / Large)
--             and that option's price_cents *replaces* the dish price;
--   addon   — the guest picks zero or more options (extra cheese, egg) and
--             each option's price_cents is *added*.
-- Only what the admin defines exists: a dish with no groups is ordered as
-- itself at its own price, so restaurants without half plates never see one.
--
-- Order items snapshot the chosen option names and prices, so groups can be
-- rewritten freely without touching history.
-- ============================================================================

create table if not exists public.modifier_groups (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  dish_id       uuid not null references public.dishes (id) on delete cascade,
  name          text not null,
  name_i18n     jsonb not null default '{}'::jsonb,
  kind          text not null check (kind in ('variant', 'addon')),
  -- addon groups only: how many options the guest must / may pick.
  -- (A variant group is always exactly one.)
  min_select    integer not null default 0 check (min_select >= 0),
  max_select    integer check (max_select is null or max_select >= 1),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists modifier_groups_dish_id_idx
  on public.modifier_groups (dish_id, sort_order);
create index if not exists modifier_groups_restaurant_id_idx
  on public.modifier_groups (restaurant_id);

create table if not exists public.modifier_options (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  group_id      uuid not null references public.modifier_groups (id) on delete cascade,
  name          text not null,
  name_i18n     jsonb not null default '{}'::jsonb,
  -- variant: the full price of the dish in this size; addon: the extra.
  price_cents   integer not null default 0 check (price_cents >= 0),
  -- The admin's own 86 switch for a single option (out of large plates).
  is_available  boolean not null default true,
  -- variant: preselected in the guest's sheet.
  is_default    boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists modifier_options_group_id_idx
  on public.modifier_options (group_id, sort_order);
create index if not exists modifier_options_restaurant_id_idx
  on public.modifier_options (restaurant_id);

drop trigger if exists modifier_groups_set_updated_at on public.modifier_groups;
create trigger modifier_groups_set_updated_at
  before update on public.modifier_groups
  for each row execute function public.set_updated_at();
drop trigger if exists modifier_options_set_updated_at on public.modifier_options;
create trigger modifier_options_set_updated_at
  before update on public.modifier_options
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: owners and managers manage; everyone at the restaurant reads; the
-- public reads on a published menu (the sheet needs options and prices).
-- ---------------------------------------------------------------------------
alter table public.modifier_groups  enable row level security;
alter table public.modifier_options enable row level security;

drop policy if exists "modifier_groups_manage_all" on public.modifier_groups;
create policy "modifier_groups_manage_all" on public.modifier_groups
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));
drop policy if exists "modifier_groups_member_read" on public.modifier_groups;
create policy "modifier_groups_member_read" on public.modifier_groups
  for select using (public.member_role(restaurant_id) is not null);
drop policy if exists "modifier_groups_public_read" on public.modifier_groups;
create policy "modifier_groups_public_read" on public.modifier_groups
  for select using (public.restaurant_is_published(restaurant_id));

drop policy if exists "modifier_options_manage_all" on public.modifier_options;
create policy "modifier_options_manage_all" on public.modifier_options
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));
drop policy if exists "modifier_options_member_read" on public.modifier_options;
create policy "modifier_options_member_read" on public.modifier_options
  for select using (public.member_role(restaurant_id) is not null);
drop policy if exists "modifier_options_public_read" on public.modifier_options;
create policy "modifier_options_public_read" on public.modifier_options
  for select using (public.restaurant_is_published(restaurant_id));

-- ---------------------------------------------------------------------------
-- set_dish_modifiers(dish, payload) — replace a dish's groups atomically.
--
-- payload: [
--   { "name": "Size", "kind": "variant", "min_select": 1, "max_select": 1,
--     "options": [ { "name": "Half", "price_cents": 12000, "is_default": true,
--                    "is_available": true }, ... ] },
--   { "name": "Extras", "kind": "addon", "min_select": 0, "max_select": null,
--     "options": [ ... ] }
-- ]
-- The app validates shape and trims strings; this function re-checks the
-- rules that matter for money and refuses with 22023 (invalid parameter).
-- ---------------------------------------------------------------------------
create or replace function public.set_dish_modifiers(p_dish_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rid        uuid;
  grp        jsonb;
  opt        jsonb;
  grp_kind   text;
  grp_id     uuid;
  g_idx      int := 0;
  o_idx      int;
  n_groups   int := 0;
  n_options  int := 0;
  n_in_group int;
begin
  select restaurant_id into rid from public.dishes where id = p_dish_id;
  if rid is null then
    raise exception 'Dish % not found', p_dish_id using errcode = '22023';
  end if;
  if not public.has_role(rid, array['owner', 'manager']) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(payload, '[]'::jsonb)) <> 'array' then
    raise exception 'payload must be an array' using errcode = '22023';
  end if;

  delete from public.modifier_groups where dish_id = p_dish_id;

  for grp in select value from jsonb_array_elements(coalesce(payload, '[]'::jsonb)) loop
    grp_kind := grp ->> 'kind';
    if grp_kind not in ('variant', 'addon') then
      raise exception 'Unknown modifier kind "%"', grp_kind using errcode = '22023';
    end if;
    if nullif(trim(coalesce(grp ->> 'name', '')), '') is null then
      raise exception 'A modifier group is missing a name' using errcode = '22023';
    end if;

    insert into public.modifier_groups
      (restaurant_id, dish_id, name, name_i18n, kind, min_select, max_select, sort_order)
    values (
      rid,
      p_dish_id,
      trim(grp ->> 'name'),
      coalesce(grp -> 'name_i18n', '{}'::jsonb),
      grp_kind,
      case when grp_kind = 'variant' then 1
           else greatest(coalesce((grp ->> 'min_select')::int, 0), 0) end,
      case when grp_kind = 'variant' then 1
           else nullif((grp ->> 'max_select')::int, 0) end,
      g_idx
    )
    returning id into grp_id;

    n_groups := n_groups + 1;
    g_idx := g_idx + 1;
    o_idx := 0;
    n_in_group := 0;

    for opt in select value from jsonb_array_elements(coalesce(grp -> 'options', '[]'::jsonb)) loop
      if nullif(trim(coalesce(opt ->> 'name', '')), '') is null then
        raise exception 'An option in "%" is missing a name', trim(grp ->> 'name')
          using errcode = '22023';
      end if;
      insert into public.modifier_options
        (restaurant_id, group_id, name, name_i18n, price_cents, is_available, is_default, sort_order)
      values (
        rid,
        grp_id,
        trim(opt ->> 'name'),
        coalesce(opt -> 'name_i18n', '{}'::jsonb),
        greatest(coalesce((opt ->> 'price_cents')::int, 0), 0),
        coalesce((opt ->> 'is_available')::boolean, true),
        coalesce((opt ->> 'is_default')::boolean, false) and grp_kind = 'variant',
        o_idx
      );
      n_options := n_options + 1;
      n_in_group := n_in_group + 1;
      o_idx := o_idx + 1;
    end loop;

    if grp_kind = 'variant' and n_in_group = 0 then
      raise exception 'Variant group "%" needs at least one option', trim(grp ->> 'name')
        using errcode = '22023';
    end if;
  end loop;

  return jsonb_build_object('groups', n_groups, 'options', n_options);
end;
$$;

revoke all on function public.set_dish_modifiers(uuid, jsonb) from public, anon;
grant execute on function public.set_dish_modifiers(uuid, jsonb) to authenticated;
