-- ============================================================================
-- Staff logins must not get a starter restaurant.
--
-- handle_new_user() skipped the restaurant when app_metadata.app_role named
-- a staff role, but the Auth server writes app_metadata only after the row
-- is inserted, so the trigger never saw it: every waiter, cashier, manager
-- and kitchen login became the owner of a pending "My Restaurant" and landed
-- in the dashboard instead of its own app. user_metadata is part of the
-- insert itself, so the hint travels there as well. The app still trusts
-- only app_metadata for the role; a self-signup that sets the hint merely
-- gets no restaurant, which harms nobody else.
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
