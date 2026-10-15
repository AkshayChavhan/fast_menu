-- ============================================================================
-- A short video behind the menu's welcome banner.
--
-- A restaurant may upload a clip of its own entrance or dining room; it
-- plays muted behind the name and description, under a dark gradient that
-- keeps the text readable. One per restaurant, optional: a menu without one
-- keeps the banner it has today.
--
-- The clips live in their own bucket with the same tenant rule as photos:
-- the first path segment is the restaurant id, and only that restaurant's
-- owner or manager may write there. Reads are public, as the menu is.
-- 15 MB and real video types only; the upload control says the same.
-- ============================================================================

alter table public.restaurants
  add column if not exists hero_video_url text;

-- The public view gains the column at the end, which is the one change
-- CREATE OR REPLACE VIEW allows without dropping it.
create or replace view public.restaurants_public as
  select id, name, slug, description, logo_url, currency, default_locale, locales,
         timezone, ordering_enabled, ordering_paused, pause_message,
         table_qr_enabled, kds_enabled, allow_takeaway, google_review_url,
         created_at, updated_at,
         public.restaurant_plan(id) = 'pro' as hide_branding,
         hero_video_url
    from public.restaurants
   where public.restaurant_is_live(id);

grant select on public.restaurants_public to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-videos', 'menu-videos', true, 15728640, array['video/mp4', 'video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "menu_videos_public_read" on storage.objects;
create policy "menu_videos_public_read" on storage.objects
  for select using (bucket_id = 'menu-videos');

drop policy if exists "menu_videos_auth_write" on storage.objects;
create policy "menu_videos_auth_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-videos' and public.can_manage_image(name));

drop policy if exists "menu_videos_auth_update" on storage.objects;
create policy "menu_videos_auth_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-videos' and public.can_manage_image(name))
  with check (bucket_id = 'menu-videos' and public.can_manage_image(name));

drop policy if exists "menu_videos_auth_delete" on storage.objects;
create policy "menu_videos_auth_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu-videos' and public.can_manage_image(name));
