-- ============================================================================
-- Importing a file can now replace a city's list instead of updating it.
--
-- "update" is what it was: match by phone then name, fill blanks, never
-- touch what a caller typed. "replace" first removes every lead in the
-- city — and with them their call logs — then imports the file as new.
-- That is a thing to do once, deliberately: owner only, counted back to
-- the caller, and written to the audit log.
-- ============================================================================

drop function if exists public.import_leads_json(text, jsonb);

create or replace function public.import_leads_json(
  p_city_id text, p_rows jsonb, p_mode text default 'update'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  city_name text;
  r         jsonb;
  lid       uuid;
  n_ins     integer := 0;
  n_upd     integer := 0;
  n_rem     integer := 0;
  v_name    text;
  v_phone   text;
  v_digits  text;
  v_norm    text;
  v_website text;
  v_wk      boolean;
  v_notes   text;
begin
  if not public.is_platform_admin() then
    raise exception 'not a platform admin' using errcode = '42501';
  end if;
  if p_mode not in ('update', 'replace') then
    raise exception 'unknown mode %', p_mode using errcode = '22023';
  end if;
  select c.name into city_name from public.lead_cities c where c.id = p_city_id;
  if city_name is null then
    raise exception 'unknown city %', p_city_id using errcode = '22023';
  end if;

  if p_mode = 'replace' then
    if not public.is_project_owner() then
      raise exception 'only the project owner can replace a list' using errcode = '42501';
    end if;
    delete from public.leads l where l.city_id = p_city_id;
    get diagnostics n_rem = row_count;
    perform public.platform_audit_log('leads.replace', p_city_id,
      jsonb_build_object('city', city_name, 'removed', n_rem));
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_name := nullif(trim(r ->> 'name'), '');
    if v_name is null then continue; end if;
    v_phone   := nullif(trim(r ->> 'phone'), '');
    v_digits  := right(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), 10);
    v_norm    := public.normalize_hotel_name(v_name);
    v_website := nullif(trim(r ->> 'website'), '');
    v_wk      := (r ->> 'website_known')::boolean;
    v_notes   := nullif(trim(r ->> 'notes'), '');

    -- Find the lead this row is about. After a replace there is nothing to
    -- find until the file itself repeats a place.
    lid := null;
    if length(v_digits) = 10 then
      select l.id into lid from public.leads l
      where l.city_id = p_city_id
        and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = v_digits
      limit 1;
    end if;
    if lid is null and v_norm is not null then
      select l.id into lid from public.leads l
      where l.city_id = p_city_id and public.normalize_hotel_name(l.name) = v_norm
      limit 1;
    end if;

    if lid is null then
      insert into public.leads
        (city_id, name, source, kind, cuisine, phone, whatsapp, email, contact_person,
         address, locality, pincode, lat, lon, website, website_status,
         digital_menu, digital_menu_provider, hard_menu, on_zomato, on_swiggy,
         online_orders, google_rating, google_review_count, google_maps_url,
         google_place_id, price_level, opening_hours, seating, source_url, image_url, extra,
         restaurant_id, created_by)
      values
        (p_city_id, v_name, 'import',
         nullif(r ->> 'kind', ''), nullif(r ->> 'cuisine', ''), v_phone,
         nullif(r ->> 'whatsapp', ''), nullif(r ->> 'email', ''),
         nullif(r ->> 'contact_person', ''), nullif(r ->> 'address', ''),
         nullif(r ->> 'locality', ''), nullif(r ->> 'pincode', ''),
         (r ->> 'lat')::double precision, (r ->> 'lon')::double precision,
         v_website,
         case when v_website is not null then 'has'
              when v_wk is false then 'none'
              else 'unknown' end,
         (r ->> 'digital_menu')::boolean, nullif(r ->> 'digital_menu_provider', ''),
         (r ->> 'hard_menu')::boolean, (r ->> 'on_zomato')::boolean,
         (r ->> 'on_swiggy')::boolean, (r ->> 'online_orders')::boolean,
         (r ->> 'google_rating')::numeric, (r ->> 'google_review_count')::integer,
         nullif(r ->> 'google_maps_url', ''), nullif(r ->> 'google_place_id', ''),
         (r ->> 'price_level')::smallint, nullif(r ->> 'opening_hours', ''),
         nullif(r ->> 'seating', ''), nullif(r ->> 'source_url', ''),
         nullif(r ->> 'image_url', ''),
         coalesce(r -> 'extra', '{}'::jsonb),
         public.match_lead_restaurant(v_name, v_phone, city_name),
         auth.uid())
      returning id into lid;
      n_ins := n_ins + 1;
      if v_notes is not null then
        insert into public.lead_notes (lead_id, author, body)
        values (lid, auth.jwt() ->> 'email', v_notes);
      end if;
    else
      update public.leads l set
        kind                  = coalesce(l.kind, nullif(r ->> 'kind', '')),
        cuisine               = coalesce(l.cuisine, nullif(r ->> 'cuisine', '')),
        phone                 = coalesce(l.phone, v_phone),
        whatsapp              = coalesce(l.whatsapp, nullif(r ->> 'whatsapp', '')),
        email                 = coalesce(l.email, nullif(r ->> 'email', '')),
        contact_person        = coalesce(l.contact_person, nullif(r ->> 'contact_person', '')),
        address               = coalesce(l.address, nullif(r ->> 'address', '')),
        locality              = coalesce(l.locality, nullif(r ->> 'locality', '')),
        pincode               = coalesce(l.pincode, nullif(r ->> 'pincode', '')),
        lat                   = coalesce(l.lat, (r ->> 'lat')::double precision),
        lon                   = coalesce(l.lon, (r ->> 'lon')::double precision),
        website               = coalesce(l.website, v_website),
        website_status        = case
                                  when l.website is not null or v_website is not null then 'has'
                                  when l.website_status = 'none' then 'none'
                                  when v_wk is false then 'none'
                                  else l.website_status
                                end,
        digital_menu          = coalesce(l.digital_menu, (r ->> 'digital_menu')::boolean),
        digital_menu_provider = coalesce(l.digital_menu_provider, nullif(r ->> 'digital_menu_provider', '')),
        hard_menu             = coalesce(l.hard_menu, (r ->> 'hard_menu')::boolean),
        on_zomato             = coalesce((r ->> 'on_zomato')::boolean, l.on_zomato),
        on_swiggy             = coalesce((r ->> 'on_swiggy')::boolean, l.on_swiggy),
        online_orders         = coalesce((r ->> 'online_orders')::boolean, l.online_orders),
        google_rating         = coalesce((r ->> 'google_rating')::numeric, l.google_rating),
        google_review_count   = coalesce((r ->> 'google_review_count')::integer, l.google_review_count),
        google_maps_url       = coalesce(nullif(r ->> 'google_maps_url', ''), l.google_maps_url),
        google_place_id       = coalesce(nullif(r ->> 'google_place_id', ''), l.google_place_id),
        price_level           = coalesce((r ->> 'price_level')::smallint, l.price_level),
        opening_hours         = coalesce(nullif(r ->> 'opening_hours', ''), l.opening_hours),
        seating               = coalesce(l.seating, nullif(r ->> 'seating', '')),
        source_url            = coalesce(nullif(r ->> 'source_url', ''), l.source_url),
        image_url             = coalesce(nullif(r ->> 'image_url', ''), l.image_url),
        extra                 = l.extra || coalesce(r -> 'extra', '{}'::jsonb),
        restaurant_id         = coalesce(l.restaurant_id,
                                  public.match_lead_restaurant(v_name, coalesce(l.phone, v_phone), city_name))
      where l.id = lid;
      n_upd := n_upd + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'removed', n_rem);
end;
$$;

revoke all on function public.import_leads_json(text, jsonb, text) from public, anon;
grant execute on function public.import_leads_json(text, jsonb, text) to authenticated;
