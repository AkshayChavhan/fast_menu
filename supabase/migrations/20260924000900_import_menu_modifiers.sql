-- ============================================================================
-- Menu import learns variants, add-ons, special dates and schedules.
--
-- The JSON payload may now carry, per dish, "special_from" / "special_until"
-- and a "modifiers" array in the same shape set_dish_modifiers() accepts, and
-- per category a "schedule" name that resolves to one of the restaurant's
-- existing schedules (unknown names simply leave the category unscheduled).
--
-- The modifier rows are written by one internal helper that both
-- set_dish_modifiers() and import_menu() call, so the money rules live in
-- exactly one place.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- insert_dish_modifiers(rid, dish, payload) — write a dish's groups from a
-- payload that has already been authorised. Not callable by clients.
-- Returns the number of options written.
-- ---------------------------------------------------------------------------
create or replace function public.insert_dish_modifiers(rid uuid, p_dish_id uuid, payload jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  grp        jsonb;
  opt        jsonb;
  grp_kind   text;
  grp_id     uuid;
  g_idx      int := 0;
  o_idx      int;
  n_options  int := 0;
  n_in_group int;
begin
  if payload is null or jsonb_typeof(payload) <> 'array' then
    return 0;
  end if;

  for grp in select value from jsonb_array_elements(payload) loop
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

  return n_options;
end;
$$;

revoke all on function public.insert_dish_modifiers(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_dish_modifiers() now delegates to the helper.
-- ---------------------------------------------------------------------------
create or replace function public.set_dish_modifiers(p_dish_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rid       uuid;
  n_options int;
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
  n_options := public.insert_dish_modifiers(rid, p_dish_id, coalesce(payload, '[]'::jsonb));

  return jsonb_build_object(
    'groups', jsonb_array_length(coalesce(payload, '[]'::jsonb)),
    'options', n_options
  );
end;
$$;

revoke all on function public.set_dish_modifiers(uuid, jsonb) from public, anon;
grant execute on function public.set_dish_modifiers(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- import_menu() with schedules, special dates and modifiers.
-- ---------------------------------------------------------------------------
create or replace function public.import_menu(rid uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cat         jsonb;
  dish        jsonb;
  new_cat_id  uuid;
  new_dish_id uuid;
  sched_id    uuid;
  cat_idx     int := 0;
  dish_idx    int;
  n_cats      int := 0;
  n_dishes    int := 0;
begin
  -- security definer bypasses RLS, so the role is checked explicitly here.
  if not public.has_role(rid, array['owner', 'manager']) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;

  -- Deleting dishes cascades to their modifier groups and options.
  delete from public.dishes where restaurant_id = rid;
  delete from public.categories where restaurant_id = rid;

  for cat in
    select value from jsonb_array_elements(coalesce(payload -> 'categories', '[]'::jsonb))
  loop
    -- A schedule is referenced by name; it must already exist for this
    -- restaurant. An unknown name leaves the category unscheduled.
    sched_id := null;
    if nullif(trim(coalesce(cat ->> 'schedule', '')), '') is not null then
      select s.id into sched_id
      from public.menu_schedules s
      where s.restaurant_id = rid
        and lower(s.name) = lower(trim(cat ->> 'schedule'))
      limit 1;
    end if;

    insert into public.categories (restaurant_id, name, name_i18n, description, sort_order, schedule_id)
    values (
      rid,
      cat ->> 'name',
      coalesce(cat -> 'name_i18n', '{}'::jsonb),
      nullif(cat ->> 'description', ''),
      cat_idx,
      sched_id
    )
    returning id into new_cat_id;

    n_cats  := n_cats + 1;
    cat_idx := cat_idx + 1;

    dish_idx := 0;
    for dish in
      select value from jsonb_array_elements(coalesce(cat -> 'dishes', '[]'::jsonb))
    loop
      insert into public.dishes (
        restaurant_id, category_id, name, name_i18n, description, description_i18n,
        price_cents, image_url, allergens, dietary_tags,
        is_available, is_featured, sort_order, special_from, special_until
      )
      values (
        rid,
        new_cat_id,
        dish ->> 'name',
        coalesce(dish -> 'name_i18n', '{}'::jsonb),
        nullif(dish ->> 'description', ''),
        coalesce(dish -> 'description_i18n', '{}'::jsonb),
        coalesce((dish ->> 'price_cents')::int, 0),
        nullif(dish ->> 'image_url', ''),
        array(select jsonb_array_elements_text(coalesce(dish -> 'allergens', '[]'::jsonb))),
        array(select jsonb_array_elements_text(coalesce(dish -> 'dietary_tags', '[]'::jsonb))),
        coalesce((dish ->> 'is_available')::boolean, true),
        coalesce((dish ->> 'is_featured')::boolean, false),
        dish_idx,
        nullif(dish ->> 'special_from', '')::date,
        nullif(dish ->> 'special_until', '')::date
      )
      returning id into new_dish_id;

      perform public.insert_dish_modifiers(rid, new_dish_id, dish -> 'modifiers');

      n_dishes := n_dishes + 1;
      dish_idx := dish_idx + 1;
    end loop;
  end loop;

  -- Dishes with no category, kept so an export/import round-trip doesn't
  -- silently drop the "More" bucket the public menu renders.
  dish_idx := 0;
  for dish in
    select value from jsonb_array_elements(coalesce(payload -> 'dishes', '[]'::jsonb))
  loop
    insert into public.dishes (
      restaurant_id, category_id, name, name_i18n, description, description_i18n,
      price_cents, image_url, allergens, dietary_tags,
      is_available, is_featured, sort_order, special_from, special_until
    )
    values (
      rid,
      null,
      dish ->> 'name',
      coalesce(dish -> 'name_i18n', '{}'::jsonb),
      nullif(dish ->> 'description', ''),
      coalesce(dish -> 'description_i18n', '{}'::jsonb),
      coalesce((dish ->> 'price_cents')::int, 0),
      nullif(dish ->> 'image_url', ''),
      array(select jsonb_array_elements_text(coalesce(dish -> 'allergens', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(dish -> 'dietary_tags', '[]'::jsonb))),
      coalesce((dish ->> 'is_available')::boolean, true),
      coalesce((dish ->> 'is_featured')::boolean, false),
      dish_idx,
      nullif(dish ->> 'special_from', '')::date,
      nullif(dish ->> 'special_until', '')::date
    )
    returning id into new_dish_id;

    perform public.insert_dish_modifiers(rid, new_dish_id, dish -> 'modifiers');

    n_dishes := n_dishes + 1;
    dish_idx := dish_idx + 1;
  end loop;

  return jsonb_build_object('categories', n_cats, 'dishes', n_dishes);
end;
$$;

revoke all on function public.import_menu(uuid, jsonb) from public, anon;
grant execute on function public.import_menu(uuid, jsonb) to authenticated;
