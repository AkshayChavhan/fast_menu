-- Tests for can_manage_image() from ../migrations/, the tenant check behind
-- the menu-images storage policies. The policies themselves need the storage
-- schema and cannot run here; this pins down the predicate they evaluate.
-- Run with ../../scripts/test-sql.sh.

\pset tuples_only on
\pset format unaligned

\set REST_A 'eaea0000-0000-0000-0000-00000000000a'
\set REST_B 'eaea0000-0000-0000-0000-00000000000b'

\echo ''
\echo '=== an owner or manager may write anywhere under their own folder ==='
update public.test_flags set owns = true, only_rid = :'REST_A';
select public.assert(
  public.can_manage_image('eaea0000-0000-0000-0000-00000000000a/9f1c2b3d.jpg'),
  'a dish photo directly under the restaurant folder');
select public.assert(
  public.can_manage_image('eaea0000-0000-0000-0000-00000000000a/logo/9f1c2b3d.png'),
  'the logo folder');
select public.assert(
  public.can_manage_image('eaea0000-0000-0000-0000-00000000000a/staff/eaea0000-0000-0000-0000-000000000099/9f1c2b3d.webp'),
  'a staff photo folder');
select public.assert(
  public.can_manage_image('EAEA0000-0000-0000-0000-00000000000A/9f1c2b3d.jpg'),
  'the restaurant id in upper case');

\echo ''
\echo '=== another restaurant''s folder is refused ==='
select public.assert(
  not public.can_manage_image('eaea0000-0000-0000-0000-00000000000b/9f1c2b3d.jpg'),
  'a member of A cannot touch B''s dish photos');
select public.assert(
  not public.can_manage_image('eaea0000-0000-0000-0000-00000000000b/logo/9f1c2b3d.png'),
  'nor B''s logo');

\echo ''
\echo '=== no role at the restaurant ==='
update public.test_flags set owns = false, only_rid = null;
select public.assert(
  not public.can_manage_image('eaea0000-0000-0000-0000-00000000000a/9f1c2b3d.jpg'),
  'a signed-in user with no role is refused');

\echo ''
\echo '=== paths that name no restaurant are refused, whatever the role ==='
update public.test_flags set owns = true, only_rid = null;
select public.assert(not public.can_manage_image('9f1c2b3d.jpg'), 'a file at the bucket root');
select public.assert(not public.can_manage_image('logo/9f1c2b3d.png'), 'a folder that is not a uuid');
select public.assert(not public.can_manage_image('eaea0000-0000-0000-0000-0000000000/9f1c2b3d.jpg'), 'a truncated uuid');
select public.assert(not public.can_manage_image('eaea0000-0000-0000-0000-00000000000a-x/9f1c2b3d.jpg'), 'a uuid with a suffix');
select public.assert(not public.can_manage_image('/eaea0000-0000-0000-0000-00000000000a/9f1c2b3d.jpg'), 'a leading slash');
select public.assert(not public.can_manage_image(''), 'an empty name');
select public.assert(not public.can_manage_image(null), 'a null name');

\echo ''
\echo 'ALL MENU IMAGES ASSERTIONS PASSED'
