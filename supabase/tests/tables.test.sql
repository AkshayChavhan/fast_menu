-- Tests for resolve_table_token() from ../migrations/: the only way a guest
-- learns which table a QR token belongs to. Run with ../../scripts/test-sql.sh.

\pset tuples_only on
\pset format unaligned

\set R 'ab1e0000-0000-0000-0000-000000000001'
\set OWNER 'ab1e0000-0000-0000-0000-0000000000aa'

insert into public.restaurants (id, owner_id, name, slug, is_published, trial_status)
values (:'R', :'OWNER', 'Token Café', 'token-cafe', true, 'active');
insert into public.tables (restaurant_id, label, qr_token, is_active)
values (:'R', 'Table 4', 'tok-live', true),
       (:'R', 'Old 9',   'tok-retired', false);

\echo ''
\echo '=== a live token on a published restaurant resolves ==='
select public.assert(
  public.resolve_table_token('token-cafe', 'tok-live') ->> 'label' = 'Table 4',
  'returns the table label');
select public.assert(
  public.resolve_table_token('token-cafe', 'tok-live') ->> 'qr_token' = 'tok-live',
  'echoes the token back');

\echo ''
\echo '=== anything else reads as unknown ==='
select public.assert(public.resolve_table_token('token-cafe', 'tok-retired') is null, 'a retired table');
select public.assert(public.resolve_table_token('token-cafe', 'nope') is null, 'an unknown token');
select public.assert(public.resolve_table_token('other-cafe', 'tok-live') is null, 'the wrong restaurant');
select public.assert(public.resolve_table_token('token-cafe', null) is null, 'a null token');

update public.restaurants set is_published = false where id = :'R';
select public.assert(public.resolve_table_token('token-cafe', 'tok-live') is null, 'an unpublished restaurant');
-- The publish gate keeps a restaurant with an inactive trial unpublished,
-- so the remaining way a live menu goes dark is the trial running out.
update public.restaurants set is_published = true, trial_ends_at = now() - interval '1 day' where id = :'R';
select public.assert(public.resolve_table_token('token-cafe', 'tok-live') is null, 'an expired trial');

delete from public.restaurants where id = :'R';

\echo ''
\echo 'ALL TABLE TOKEN ASSERTIONS PASSED'
