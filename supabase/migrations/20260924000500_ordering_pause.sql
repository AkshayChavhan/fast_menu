-- ============================================================================
-- Pause ordering ("kitchen closed") without unpublishing the menu.
--
-- Managers hold ordering:pause but may not update restaurants directly (that
-- policy stays owner-only), so the switch goes through a role-checked
-- function. Owners use the same path so there is one code path to test.
-- ============================================================================

create or replace function public.set_ordering_paused(rid uuid, paused boolean, message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(rid, array['owner', 'manager']) then
    raise exception 'Not authorised for restaurant %', rid using errcode = '42501';
  end if;

  update public.restaurants
     set ordering_paused = paused,
         pause_message   = nullif(trim(coalesce(message, '')), '')
   where id = rid;
end;
$$;

revoke all on function public.set_ordering_paused(uuid, boolean, text) from public, anon;
grant execute on function public.set_ordering_paused(uuid, boolean, text) to authenticated;
