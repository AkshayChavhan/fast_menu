-- ============================================================================
-- Operators are not restaurants.
--
-- Every signup gets a starter restaurant, which is right for an owner and
-- wrong for the person who runs the platform: their login ends up owning
-- an empty "My Restaurant" that counts as one on /admin. Three changes:
-- the signup trigger skips the starter restaurant for an email already in
-- platform_admins; the ones already created can be listed and removed from
-- the admins page, with a guard that only an empty, unpublished one goes;
-- and the app sends an operator to /admin after sign-in (see auth/home).
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base_slug text;
  final_slug text;
  n int := 0;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  if coalesce(new.raw_app_meta_data ->> 'app_role', new.raw_user_meta_data ->> 'app_role', '')
     in ('manager', 'cashier', 'waiter', 'kitchen') then
    return new;
  end if;

  -- An operator, added to platform_admins before their first sign-in,
  -- runs the platform and not a restaurant.
  if exists (
    select 1 from public.platform_admins a where lower(a.email) = lower(coalesce(new.email, ''))
  ) then
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
-- A placeholder: owned by a platform admin, never published, nothing in it.
-- Anything with a dish, a category, a table or an order is a real
-- restaurant whoever owns it, and is not listed here.
-- ---------------------------------------------------------------------------
create or replace function public.operator_placeholder_restaurants()
returns table (restaurant_id uuid, name text, slug text, owner_email text, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select r.id, r.name, r.slug, u.email, r.created_at
  from public.restaurants r
  join auth.users u on u.id = r.owner_id
  join public.platform_admins a on lower(a.email) = lower(u.email)
  where public.is_project_owner()
    and not r.is_published
    and not exists (select 1 from public.dishes d where d.restaurant_id = r.id)
    and not exists (select 1 from public.categories c where c.restaurant_id = r.id)
    and not exists (select 1 from public.tables t where t.restaurant_id = r.id)
    and not exists (select 1 from public.orders o where o.restaurant_id = r.id)
  order by r.created_at
$$;

create or replace function public.remove_placeholder_restaurant(rid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if not public.is_project_owner() then
    raise exception 'not the project owner' using errcode = '42501';
  end if;
  select * into r from public.operator_placeholder_restaurants() p where p.restaurant_id = rid;
  if r is null then
    raise exception 'not a placeholder restaurant' using errcode = '22023';
  end if;
  delete from public.restaurants where id = rid;
  perform public.platform_audit_log('restaurant.remove_placeholder', rid::text,
    jsonb_build_object('name', r.name, 'slug', r.slug, 'owner_email', r.owner_email));
end;
$$;

revoke all on function public.operator_placeholder_restaurants() from public, anon;
revoke all on function public.remove_placeholder_restaurant(uuid) from public, anon;
grant execute on function public.operator_placeholder_restaurants() to authenticated;
grant execute on function public.remove_placeholder_restaurant(uuid) to authenticated;
