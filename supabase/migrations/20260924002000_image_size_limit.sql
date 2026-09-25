-- ============================================================================
-- Cap uploads to the menu-images bucket at 1 MB and to real image types.
--
-- The upload control checks both before sending, but a bucket rule holds for
-- any request that skips the UI, and it is what keeps phone-camera originals
-- (several MB each) from filling the store. Bucket settings live in Postgres
-- on Supabase, so this is an ordinary migration; on a fresh database it runs
-- right after the baseline creates the bucket. Existing files are untouched;
-- `pnpm images:prune` lists the ones nothing references any more.
-- ============================================================================

update storage.buckets
   set file_size_limit = 1048576,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'menu-images';
