-- ============================================================================
-- Staff accounts and roles.
--
-- The owner stays restaurants.owner_id. Everyone else who works at a
-- restaurant — manager, cashier, waiter, kitchen — is a row in
-- restaurant_staff. Authorization reads this table through member_role();
-- it never trusts JWT metadata, which a user can edit.
--
-- A staff user belongs to exactly one restaurant (unique user_id), so login
-- routing is a single lookup. Owners can still own several restaurants.
-- ============================================================================

create table if not exists public.restaurant_staff (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null check (role in ('manager', 'cashier', 'waiter', 'kitchen')),
  display_name  text,
  -- Deactivating keeps the row (and the audit trail) but revokes every
  -- permission at once; the login itself still works but lands nowhere.
  is_active     boolean not null default true,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists restaurant_staff_user_id_key
  on public.restaurant_staff (user_id);
create index if not exists restaurant_staff_restaurant_role_idx
  on public.restaurant_staff (restaurant_id, role);

drop trigger if exists restaurant_staff_set_updated_at on public.restaurant_staff;
create trigger restaurant_staff_set_updated_at
  before update on public.restaurant_staff
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Role helpers. security definer so policies can consult restaurants and
-- restaurant_staff without recursing into their own RLS.
-- ---------------------------------------------------------------------------

-- The signed-in user's role at a restaurant: 'owner', a staff role, or null.
create or replace function public.member_role(rid uuid)
returns text language sql security definer stable set search_path = public as $$
  select case
    when exists (
      select 1 from public.restaurants r
      where r.id = rid and r.owner_id = auth.uid()
    ) then 'owner'
    else (
      select s.role from public.restaurant_staff s
      where s.restaurant_id = rid
        and s.user_id = auth.uid()
        and s.is_active
      limit 1
    )
  end
$$;

-- Does the signed-in user hold one of `roles` at this restaurant?
create or replace function public.has_role(rid uuid, roles text[])
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(public.member_role(rid) = any (roles), false)
$$;

-- ---------------------------------------------------------------------------
-- New-user provisioning: staff accounts are created by an admin through the
-- Auth Admin API with app_metadata.app_role set. They get a profile but no
-- restaurant of their own. (app_metadata is server-controlled; user_metadata
-- would be editable by the user and must not be trusted here.)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base_slug text;
  final_slug text;
  n int := 0;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  if coalesce(new.raw_app_meta_data ->> 'app_role', '') in ('manager', 'cashier', 'waiter', 'kitchen') then
    return new;
  end if;

  -- derive a slug from email local-part, ensure uniqueness
  base_slug := regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then base_slug := 'restaurant'; end if;
  final_slug := base_slug;
  while exists (select 1 from public.restaurants where slug = final_slug) loop
    n := n + 1;
    final_slug := base_slug || '-' || n;
  end loop;

  insert into public.restaurants (owner_id, name, slug)
  values (new.id, 'My Restaurant', final_slug);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.restaurant_staff enable row level security;

-- Anyone can read their own staff row (login routing, "where do I work").
drop policy if exists "staff_self_read" on public.restaurant_staff;
create policy "staff_self_read" on public.restaurant_staff
  for select using (user_id = auth.uid());

-- Owners and managers see the whole roster.
drop policy if exists "staff_manage_read" on public.restaurant_staff;
create policy "staff_manage_read" on public.restaurant_staff
  for select using (public.has_role(restaurant_id, array['owner', 'manager']));

-- Owners manage every role; managers manage everyone below manager.
drop policy if exists "staff_manage_write" on public.restaurant_staff;
create policy "staff_manage_write" on public.restaurant_staff
  for all using (
    public.has_role(restaurant_id, array['owner'])
    or (public.has_role(restaurant_id, array['manager']) and role <> 'manager')
  )
  with check (
    public.has_role(restaurant_id, array['owner'])
    or (public.has_role(restaurant_id, array['manager']) and role <> 'manager')
  );

-- Staff need to read the restaurant they work at (name, currency, switches).
-- Updates stay owner-only; the few fields other roles may change go through
-- role-checked functions.
drop policy if exists "restaurants_member_read" on public.restaurants;
create policy "restaurants_member_read" on public.restaurants
  for select using (public.member_role(id) is not null);

-- Menu, pairings and reviews: owners and managers manage them.
drop policy if exists "categories_owner_all" on public.categories;
drop policy if exists "categories_manage_all" on public.categories;
create policy "categories_manage_all" on public.categories
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));

drop policy if exists "dishes_owner_all" on public.dishes;
drop policy if exists "dishes_manage_all" on public.dishes;
create policy "dishes_manage_all" on public.dishes
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));

drop policy if exists "pairings_owner_all" on public.dish_pairings;
drop policy if exists "pairings_manage_all" on public.dish_pairings;
create policy "pairings_manage_all" on public.dish_pairings
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));

drop policy if exists "review_forms_owner_all" on public.review_forms;
drop policy if exists "review_forms_manage_all" on public.review_forms;
create policy "review_forms_manage_all" on public.review_forms
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));

drop policy if exists "reviews_owner_all" on public.reviews;
drop policy if exists "reviews_manage_all" on public.reviews;
create policy "reviews_manage_all" on public.reviews
  for all using (public.has_role(restaurant_id, array['owner', 'manager']))
  with check (public.has_role(restaurant_id, array['owner', 'manager']));

-- ---------------------------------------------------------------------------
-- import_menu(): managers may import too. Only the authorisation line
-- changes; the body is otherwise the baseline's.
-- ---------------------------------------------------------------------------
create or replace function public.import_menu(rid uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cat        jsonb;
  dish       jsonb;
  new_cat_id uuid;
  cat_idx    int := 0;
  dish_idx   int;
  n_cats     int := 0;
  n_dishes   int := 0;
begin
  -- security definer bypasses RLS, so the role is checked explicitly here.
  if not public.has_role(rid, array['owner', 'manager']) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;

  delete from public.dishes where restaurant_id = rid;
  delete from public.categories where restaurant_id = rid;

  for cat in
    select value from jsonb_array_elements(coalesce(payload -> 'categories', '[]'::jsonb))
  loop
    insert into public.categories (restaurant_id, name, name_i18n, description, sort_order)
    values (
      rid,
      cat ->> 'name',
      coalesce(cat -> 'name_i18n', '{}'::jsonb),
      nullif(cat ->> 'description', ''),
      cat_idx
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
        is_available, is_featured, sort_order
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
        dish_idx
      );

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
      is_available, is_featured, sort_order
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
      dish_idx
    );

    n_dishes := n_dishes + 1;
    dish_idx := dish_idx + 1;
  end loop;

  return jsonb_build_object('categories', n_cats, 'dishes', n_dishes);
end;
$$;

revoke all on function public.import_menu(uuid, jsonb) from public, anon;
grant execute on function public.import_menu(uuid, jsonb) to authenticated;
