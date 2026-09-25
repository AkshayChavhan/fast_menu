-- ============================================================================
-- import_menu(): also carry restaurant settings and schedule definitions.
--
-- Before this, a menu file held only categories and dishes, and a category's
-- "schedule" had to match a schedule that already existed — so exporting a
-- menu and importing it into a fresh restaurant silently dropped every
-- schedule link, and nothing restored the currency, languages, timezone or
-- ordering switches.
--
-- Settings are an allowlist (see the comment in the body). Schedules are
-- matched by name and upserted, never deleted.
-- ============================================================================

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
  sch         jsonb;
  st          jsonb;
  cat_idx     int := 0;
  n_scheds    int := 0;
  dish_idx    int;
  n_cats      int := 0;
  n_dishes    int := 0;
begin
  -- security definer bypasses RLS, so the role is checked explicitly here.
  if not public.has_role(rid, array['owner', 'manager']) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;

  -- ---------------------------------------------------------------------
  -- Restaurant settings. Only the keys present in the file are touched, so a
  -- partial block is a partial update. The column list is an allowlist that
  -- mirrors the one in menu-import.ts: slug, is_published, owner_id, trial and
  -- billing columns are absent on purpose, because an uploaded file must not
  -- be able to move a menu's public URL, publish it, or change who pays.
  -- ---------------------------------------------------------------------
  st := payload -> 'settings';
  if st is not null and jsonb_typeof(st) = 'object' then
    update public.restaurants r set
      currency          = coalesce(st ->> 'currency', r.currency),
      default_locale    = coalesce(st ->> 'default_locale', r.default_locale),
      -- An empty array would leave the menu with no language at all.
      locales           = case
                            when st ? 'locales'
                             and jsonb_array_length(st -> 'locales') > 0
                            then array(select jsonb_array_elements_text(st -> 'locales'))
                            else r.locales
                          end,
      timezone          = coalesce(st ->> 'timezone', r.timezone),
      ordering_enabled  = coalesce((st ->> 'ordering_enabled')::boolean, r.ordering_enabled),
      allow_takeaway    = coalesce((st ->> 'allow_takeaway')::boolean, r.allow_takeaway),
      table_qr_enabled  = coalesce((st ->> 'table_qr_enabled')::boolean, r.table_qr_enabled),
      kds_enabled       = coalesce((st ->> 'kds_enabled')::boolean, r.kds_enabled),
      -- Explicit null clears the link, so test for the key, not the value.
      google_review_url = case
                            when st ? 'google_review_url'
                            then nullif(st ->> 'google_review_url', '')
                            else r.google_review_url
                          end,
      updated_at        = now()
    where r.id = rid;
  end if;

  -- ---------------------------------------------------------------------
  -- Schedules, matched by name so re-importing the same file updates the
  -- window instead of piling up duplicates. Schedules the file omits are
  -- left alone rather than deleted: categories outside this import may
  -- still point at them, and the file names them rather than owning them.
  -- ---------------------------------------------------------------------
  for sch in
    select value from jsonb_array_elements(coalesce(payload -> 'schedules', '[]'::jsonb))
  loop
    select s.id into sched_id
    from public.menu_schedules s
    where s.restaurant_id = rid
      and lower(s.name) = lower(trim(sch ->> 'name'))
    limit 1;

    if sched_id is null then
      insert into public.menu_schedules (restaurant_id, name, days, starts_at, ends_at, is_active)
      values (
        rid,
        trim(sch ->> 'name'),
        array(select jsonb_array_elements_text(coalesce(sch -> 'days', '[]'::jsonb)))::smallint[],
        (sch ->> 'starts_at')::time,
        (sch ->> 'ends_at')::time,
        coalesce((sch ->> 'is_active')::boolean, true)
      );
    else
      update public.menu_schedules set
        days       = array(select jsonb_array_elements_text(coalesce(sch -> 'days', '[]'::jsonb)))::smallint[],
        starts_at  = (sch ->> 'starts_at')::time,
        ends_at    = (sch ->> 'ends_at')::time,
        is_active  = coalesce((sch ->> 'is_active')::boolean, true),
        updated_at = now()
      where id = sched_id;
    end if;

    n_scheds := n_scheds + 1;
  end loop;

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

  return jsonb_build_object('categories', n_cats, 'dishes', n_dishes, 'schedules', n_scheds);
end;
$$;

revoke all on function public.import_menu(uuid, jsonb) from public, anon;
grant execute on function public.import_menu(uuid, jsonb) to authenticated;
