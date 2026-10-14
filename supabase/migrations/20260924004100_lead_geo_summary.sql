-- ============================================================================
-- The leads page's geography, for a cache.
--
-- list_lead_states() answers only a platform admin, by reading the caller's
-- JWT. A cached read runs with no caller — the server's own key — so it
-- gets nothing. This variant does the same work with no check of its own
-- and may be executed by the service role alone: the page that uses it has
-- already turned a non-admin away, and what it returns is a list of Indian
-- cities with a count beside each.
-- ============================================================================

create or replace function public.lead_geo_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'generated_at', now(),
    'states', coalesce((
      select jsonb_agg(jsonb_build_object(
        'state', s.state, 'city_count', s.city_count, 'lead_count', s.lead_count
      ) order by s.state)
      from (
        select c.state, count(distinct c.id)::int as city_count, count(l.id)::int as lead_count
        from public.lead_cities c
        left join public.leads l on l.city_id = c.id
        group by c.state
      ) s
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.lead_geo_summary() from public, anon, authenticated;
grant execute on function public.lead_geo_summary() to service_role;
