-- ============================================================================
-- Leads: import from a JSON file, and the facts a call establishes.
--
-- OpenStreetMap gives names. A JSON file — from Claude with web search, a
-- JustDial export, a field agent's spreadsheet — gives the rest: Google
-- rating, Zomato/Swiggy presence, whether they already have a QR menu.
-- Anything the file does not know is NA, which lands here as null and is
-- shown as unknown, never as "no".
--
-- Google's own API forbids storing its data; a file a person assembled
-- and uploaded is theirs, so these columns hold what they supplied.
-- ============================================================================

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads
  add constraint leads_source_check check (source in ('osm', 'manual', 'import'));

alter table public.leads
  add column if not exists kind                  text
    check (kind is null or kind in ('restaurant', 'cafe', 'dhaba', 'cloud_kitchen',
                                    'bar', 'bakery', 'sweet_shop', 'other')),
  add column if not exists whatsapp              text,
  add column if not exists email                 text,
  add column if not exists contact_person        text,
  add column if not exists locality              text,
  add column if not exists pincode               text,
  add column if not exists google_rating         numeric(2,1)
    check (google_rating is null or (google_rating >= 0 and google_rating <= 5)),
  add column if not exists google_review_count   integer
    check (google_review_count is null or google_review_count >= 0),
  add column if not exists google_maps_url       text,
  add column if not exists google_place_id       text,
  add column if not exists price_level           smallint
    check (price_level is null or (price_level between 1 and 4)),
  add column if not exists opening_hours         text,
  add column if not exists seating               text,
  -- Three-valued on purpose: true, false, or not yet known.
  add column if not exists digital_menu          boolean,
  add column if not exists digital_menu_provider text,
  add column if not exists hard_menu             boolean,
  add column if not exists on_zomato             boolean,
  add column if not exists on_swiggy             boolean,
  add column if not exists online_orders         boolean,
  -- Flipped by the first logged call: a person has confirmed the details.
  add column if not exists verified              boolean not null default false,
  add column if not exists source_url            text,
  -- A public photo of the place, if the file knew of one. Shown, not copied.
  add column if not exists image_url             text,
  -- Whatever else the file carried, so nothing is lost.
  add column if not exists extra                 jsonb not null default '{}'::jsonb;

create index if not exists leads_city_rating_idx
  on public.leads (city_id, google_rating desc nulls last);

-- ---------------------------------------------------------------------------
-- import_leads_json() — one city, many rows. Each row is matched to an
-- existing lead by phone, then by normalised name; a match is updated, the
-- rest are inserted. What a caller typed is never overwritten: contact
-- details only fill blanks, and status, pending, assignment and notes are
-- left alone. Facts the file states (rating, flags) do replace older ones:
-- the file is the newer observation. Returns {inserted, updated}.
--
-- p_rows: [{name, kind, cuisine, phone, whatsapp, email, contact_person,
--           address, locality, pincode, lat, lon, website, website_known
--           (true/false/null), digital_menu, digital_menu_provider,
--           hard_menu, on_zomato, on_swiggy, online_orders,
--           google_rating, google_review_count, google_maps_url,
--           google_place_id, price_level, opening_hours, seating,
--           source_url, image_url, notes, extra}, ...]
-- Nulls mean unknown; the TypeScript side has already turned NA into null.
-- ---------------------------------------------------------------------------
create or replace function public.import_leads_json(p_city_id text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  city_name text;
  r         jsonb;
  lid       uuid;
  n_ins     integer := 0;
  n_upd     integer := 0;
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
  select c.name into city_name from public.lead_cities c where c.id = p_city_id;
  if city_name is null then
    raise exception 'unknown city %', p_city_id using errcode = '22023';
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

    -- Find the lead this row is about.
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
        -- A caller's answer on the phone beats the file; the file beats blank.
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

  return jsonb_build_object('inserted', n_ins, 'updated', n_upd);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_lead_facts() — what the caller learnt on the phone. Any field left
-- null is "don't change", so the form can send only what was answered.
-- Logging a call also marks the lead verified: a person has spoken to them.
-- ---------------------------------------------------------------------------
create or replace function public.set_lead_facts(
  p_lead_id uuid,
  p_digital_menu boolean default null,
  p_digital_menu_provider text default null,
  p_hard_menu boolean default null,
  p_online_orders boolean default null,
  p_verified boolean default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not a platform admin' using errcode = '42501';
  end if;
  update public.leads l set
    digital_menu          = coalesce(p_digital_menu, l.digital_menu),
    digital_menu_provider = coalesce(nullif(trim(p_digital_menu_provider), ''), l.digital_menu_provider),
    hard_menu             = coalesce(p_hard_menu, l.hard_menu),
    online_orders         = coalesce(p_online_orders, l.online_orders),
    verified              = coalesce(p_verified, l.verified)
  where l.id = p_lead_id;
  if not found then
    raise exception 'unknown lead %', p_lead_id using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.import_leads_json(text, jsonb) from public, anon;
revoke all on function public.set_lead_facts(uuid, boolean, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.import_leads_json(text, jsonb) to authenticated;
grant execute on function public.set_lead_facts(uuid, boolean, text, boolean, boolean, boolean) to authenticated;
