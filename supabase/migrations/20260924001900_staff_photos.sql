-- ============================================================================
-- A profile photo for each staff member.
--
-- Shown on the roster so an owner with thirty logins can tell them apart,
-- and ready for the staff apps. The image itself goes to the public
-- menu-images bucket like dish photos and the logo, under an unguessable
-- per-restaurant path; the row keeps only the public URL. It is set by
-- whoever may manage the account (the owner for every role, a manager for
-- everyone below manager), which is exactly what staff_manage_write already
-- allows, so no new policy is needed.
-- ============================================================================

alter table public.restaurant_staff
  add column if not exists avatar_url text;
