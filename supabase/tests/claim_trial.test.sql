-- Tests for the one-trial-per-hotel functions from ../migrations/:
-- normalize_hotel_name(), claim_trial(), review_trial(), is_platform_admin().
-- Run with ../../scripts/test-sql.sh.

\pset tuples_only on
\pset format unaligned

\set OWNER_A 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set OWNER_B 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set OWNER_C 'cccccccc-cccc-cccc-cccc-cccccccccccc'
\set REST_A  '11111111-1111-1111-1111-111111111111'
\set REST_B  '22222222-2222-2222-2222-222222222222'
\set REST_C  '33333333-3333-3333-3333-333333333333'

-- The trigger under test.
create trigger restaurants_enforce_trial
  before update of is_published on public.restaurants
  for each row execute function public.enforce_trial_before_publish();

\echo ''
\echo '=== normalize_hotel_name ==='
select public.assert(
  public.normalize_hotel_name('Hotel Sai Palace, Pune') = 'sai palace pune',
  'drops generic words and punctuation');
select public.assert(
  public.normalize_hotel_name('THE   Copper-Fork Restaurant & Bar') = 'copper fork',
  'is case-insensitive and collapses whitespace');
select public.assert(
  public.normalize_hotel_name('Hotel') is null,
  'a name made only of generic words normalises to null');

\echo ''
\echo '=== setup: three owners, three restaurants ==='
insert into auth.users (id, email, phone, phone_confirmed_at) values
  (:'OWNER_A', 'a@example.com', '919876543210', now()),
  (:'OWNER_B', 'b@example.com', '919876543210', now()),   -- same phone as A
  (:'OWNER_C', 'c@example.com', '919999999999', null);    -- never verified
insert into public.restaurants (id, owner_id, name, slug) values
  (:'REST_A', :'OWNER_A', 'Hotel Sai Palace', 'sai-a'),
  (:'REST_B', :'OWNER_B', 'Sai Palace Family Restaurant', 'sai-b'),
  (:'REST_C', :'OWNER_C', 'Blue Lagoon Cafe', 'blue-c');

\echo ''
\echo '=== ownership ==='
update public.test_auth set uid = :'OWNER_B';
do $$
begin
  perform public.claim_trial('11111111-1111-1111-1111-111111111111', '+91 98765 43210', null, 'Pune', '411001');
  raise exception 'FAIL  claiming someone else''s restaurant should be refused';
exception when insufficient_privilege then
  raise notice '  PASS  claiming another owner''s restaurant is refused with 42501';
end $$;

\echo ''
\echo '=== phone mode: the number must be verified by Auth ==='
update public.test_auth set uid = :'OWNER_C';
select public.assert(
  public.claim_trial(:'REST_C', '+91 99999 99999', null, 'Goa', '403001') = '{"status": "error", "reason": "phone_unverified"}'::jsonb,
  'an unverified phone is an error, not a claim');
select public.assert(
  (select trial_status from public.restaurants where id = :'REST_C') = 'pending',
  'the restaurant stays pending');

update public.test_auth set uid = :'OWNER_A';
select public.assert(
  public.claim_trial(:'REST_A', '+91 91111 11111', null, 'Pune', '411001') = '{"status": "error", "reason": "phone_unverified"}'::jsonb,
  'a verified user claiming with a different number is refused');
select public.assert(
  public.claim_trial(:'REST_A', '12', null, 'Pune', '411001') = '{"status": "error", "reason": "phone_invalid"}'::jsonb,
  'a number that is too short is invalid');
select public.assert(
  public.claim_trial(:'REST_A', '+91 98765 43210', 'not-a-gstin', 'Pune', '411001') = '{"status": "error", "reason": "gstin_invalid"}'::jsonb,
  'a malformed GSTIN is invalid');

\echo ''
\echo '=== a clean claim activates the trial ==='
select public.assert(
  public.claim_trial(:'REST_A', '+91 98765 43210', '27AAPFU0939F1ZV', ' Pune ', '411 001') = '{"status": "active", "reason": null}'::jsonb,
  'first claim of this phone is active');
select public.assert(
  (select trial_status = 'active'
      and phone = '919876543210'
      and phone_verified_at is not null
      and gstin = '27AAPFU0939F1ZV'
      and city = 'Pune'
      and pincode = '411001'
      and trial_ends_at > now() + interval '14 days'
   from public.restaurants where id = :'REST_A'),
  'identity fields are normalised and stored; the 15 days start now');
select public.assert(
  (select count(*) from public.trial_claims where restaurant_id = :'REST_A' and flagged = false) = 1,
  'one unflagged claim row is recorded');
select public.assert(
  public.claim_trial(:'REST_A', '+91 98765 43210', null, 'Pune', '411001') = '{"status": "active", "reason": null}'::jsonb,
  'claiming again is a no-op once active');

\echo ''
\echo '=== the same phone cannot claim a second trial ==='
update public.test_auth set uid = :'OWNER_B';
select public.assert(
  public.claim_trial(:'REST_B', '+91 98765 43210', null, 'Pune', '411001') = '{"status": "denied", "reason": "phone"}'::jsonb,
  'a phone already on a claim is denied');
select public.assert(
  (select trial_status from public.restaurants where id = :'REST_B') = 'denied',
  'the restaurant is marked denied');
select public.assert(
  (select count(*) from public.trial_claims where restaurant_id = :'REST_B') = 0,
  'no claim row is written for a denied restaurant');
select public.assert(
  public.claim_trial(:'REST_B', '+91 98765 43210', null, 'Pune', '411001') = '{"status": "denied", "reason": "already_denied"}'::jsonb,
  'a denied restaurant stays denied');

\echo ''
\echo '=== a similar name in the same pincode is parked for review ==='
update public.platform_settings set value = 'none' where key = 'trial_verification';
update public.test_auth set uid = :'OWNER_C';
update public.restaurants set name = 'Sai Palace Hotel' where id = :'REST_C';
select public.assert(
  public.claim_trial(:'REST_C', '+91 99999 99999', null, 'Pune', '411001') = '{"status": "needs_review", "reason": "similar_name"}'::jsonb,
  'in none mode an unverified phone is accepted, and the look-alike name is flagged');
select public.assert(
  (select trial_status = 'needs_review' and phone_verified_at is null
   from public.restaurants where id = :'REST_C'),
  'the restaurant waits for review and the phone is not marked verified');
select public.assert(
  (select flagged from public.trial_claims where restaurant_id = :'REST_C') = true,
  'its claim row is flagged');

\echo ''
\echo '=== a GSTIN already claimed is refused even from a new phone ==='
insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'd@example.com', '918888888888', now());
insert into public.restaurants (id, owner_id, name, slug) values
  ('44444444-4444-4444-4444-444444444444', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Totally Different', 'diff-d');
update public.test_auth set uid = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
select public.assert(
  public.claim_trial('44444444-4444-4444-4444-444444444444', '918888888888', '27aapfu0939f1zv', 'Mumbai', '400001') = '{"status": "denied", "reason": "gstin"}'::jsonb,
  'the GSTIN check is case-insensitive and exact');

\echo ''
\echo '=== publishing needs an active trial ==='
do $$
begin
  update public.restaurants set is_published = true where id = '33333333-3333-3333-3333-333333333333';
  raise exception 'FAIL  publishing a needs_review restaurant should be blocked';
exception when raise_exception then
  raise notice '  PASS  publishing is blocked while the trial is not active';
end $$;
update public.restaurants set is_published = true where id = :'REST_A';
select public.assert(
  (select is_published from public.restaurants where id = :'REST_A') = true,
  'an active restaurant publishes normally');

\echo ''
\echo '=== platform admin review ==='
update public.test_auth set uid = :'OWNER_A', email = 'a@example.com';
select public.assert(public.is_platform_admin() = false, 'an ordinary owner is not a platform admin');
select public.assert((select count(*) from public.list_trial_reviews()) = 0, 'non-admins see no review queue');
do $$
begin
  perform public.review_trial('33333333-3333-3333-3333-333333333333', true);
  raise exception 'FAIL  a non-admin must not review trials';
exception when insufficient_privilege then
  raise notice '  PASS  a non-admin cannot review trials';
end $$;

insert into public.platform_admins (email) values ('Admin@Example.com');
update public.test_auth set email = 'admin@example.com';
select public.assert(public.is_platform_admin() = true, 'the allowlist match is case-insensitive');
select public.assert(
  (select count(*) from public.list_trial_reviews() where restaurant_id = :'REST_C') = 1,
  'the flagged restaurant is in the queue');
select public.assert(
  (select lookalikes -> 0 ->> 'slug' from public.list_trial_reviews() where restaurant_id = :'REST_C') = 'sai-a',
  'the queue names the look-alike it collided with');

select public.review_trial(:'REST_C', true);
select public.assert(
  (select trial_status = 'active' and trial_ends_at > now() + interval '14 days'
   from public.restaurants where id = :'REST_C'),
  'approving activates the trial with a fresh 15 days');
select public.assert(
  (select flagged from public.trial_claims where restaurant_id = :'REST_C') = false,
  'approval clears the flag');

select public.review_trial(:'REST_A', false);
select public.assert(
  (select trial_status = 'denied' and is_published = false
   from public.restaurants where id = :'REST_A'),
  'denying locks the restaurant and unpublishes it');
select public.assert(
  (select count(*) from public.trial_claims where restaurant_id = :'REST_A') = 0,
  'denial releases the claim so the rightful hotel can use the phone');

\echo ''
\echo 'ALL TRIAL ASSERTIONS PASSED'
