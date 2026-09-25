-- ============================================================================
-- Guests resolve one table token; they may not list a restaurant's tokens.
--
-- tables_public_read was a row filter, and RLS cannot see the caller's WHERE
-- or column list: with the anon key anyone could read every active table's
-- qr_token for a published restaurant and then place orders or fire
-- bill/waiter requests on any table without being there. The lookup moves
-- into a security-definer function that takes the token as input and
-- returns that one table or null. Staff keep reading tables through
-- tables_member_read; the ordering functions already take the token
-- server-side.
-- ============================================================================

create or replace function public.resolve_table_token(p_slug text, p_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object('id', t.id, 'label', t.label, 'qr_token', t.qr_token)
    from public.tables t
    join public.restaurants r on r.id = t.restaurant_id
   where r.slug = p_slug
     and r.is_published
     and r.trial_status = 'active'
     and r.trial_ends_at > now()
     and t.qr_token = p_token
     and t.is_active
   limit 1
$$;

revoke all on function public.resolve_table_token(text, text) from public;
grant execute on function public.resolve_table_token(text, text) to anon, authenticated;

drop policy if exists "tables_public_read" on public.tables;
