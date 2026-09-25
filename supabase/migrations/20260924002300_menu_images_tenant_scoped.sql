-- ============================================================================
-- Scope the menu-images write policies to the restaurant that owns the path.
--
-- The baseline let any signed-in user insert, update or delete any object in
-- the bucket: the policies were "to authenticated" with only
-- bucket_id = 'menu-images' to check. Sign-up is open and object paths are
-- public (they are the image URLs on every published menu, and the bucket's
-- select policy lets anyone list it), so one account could wipe or replace
-- every other restaurant's dish photos, logo and staff avatars. The only
-- tenant check was imagePathForRestaurant() in the app's own cleanup helper,
-- which the Storage API never sees.
--
-- Every upload goes to `<restaurantId>/...` (DishForm, SettingsForm's
-- `<id>/logo`, StaffManager's `<id>/staff/...`), so the first path segment
-- names the tenant. can_manage_image() reads it back and asks has_role()
-- whether the caller is that restaurant's owner or manager, the same roles
-- that may edit the rows the images belong to. The uuid is checked before
-- the cast so a stray path is refused instead of raising. Reads stay public:
-- the bucket is public and the menu embeds these URLs.
--
-- Unlike the storage schema, the function is plain SQL, so the SQL test
-- cluster can run it (tests/menu_images.test.sql).
-- ============================================================================

create or replace function public.can_manage_image(object_name text)
returns boolean language sql stable set search_path = public as $$
  select case
    when split_part(object_name, '/', 1)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.has_role(split_part(object_name, '/', 1)::uuid, array['owner', 'manager'])
    else false
  end
$$;

grant execute on function public.can_manage_image(text) to authenticated;

drop policy if exists "menu_images_auth_write" on storage.objects;
create policy "menu_images_auth_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-images' and public.can_manage_image(name));

drop policy if exists "menu_images_auth_update" on storage.objects;
create policy "menu_images_auth_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-images' and public.can_manage_image(name))
  with check (bucket_id = 'menu-images' and public.can_manage_image(name));

drop policy if exists "menu_images_auth_delete" on storage.objects;
create policy "menu_images_auth_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu-images' and public.can_manage_image(name));
