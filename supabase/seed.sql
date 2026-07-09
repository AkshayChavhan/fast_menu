-- ============================================================================
-- fast_menu — demo seed
-- Creates a published demo restaurant at slug "demo" so the public menu at
-- /m/demo (linked from the landing page) works out of the box, complete with
-- categories, photographed dishes, allergens, dietary tags, an 86'd dish,
-- multi-language names, and upsell pairings.
--
-- Run AFTER schema.sql, and AFTER you have signed up at least one user
-- (restaurants.owner_id references auth.users). Run it in the Supabase SQL
-- editor or: supabase db execute --file supabase/seed.sql
--
-- Idempotent: re-running deletes and recreates the "demo" restaurant.
-- ============================================================================

do $$
declare
  v_owner   uuid;
  v_rest    uuid;
  c_start   uuid;   -- Starters
  c_mains   uuid;   -- Mains
  c_drinks  uuid;   -- Drinks
  c_dessert uuid;   -- Desserts
  -- dish ids we reference for pairings
  d_bruschetta uuid;
  d_calamari   uuid;
  d_burrata    uuid;
  d_ribeye     uuid;
  d_salmon     uuid;
  d_risotto    uuid;
  d_seabass    uuid;   -- the 86'd dish
  d_tiramisu   uuid;
  d_negroni    uuid;
  d_chianti    uuid;
  d_spritz     uuid;
begin
  -- Pick an owner: the first existing auth user.
  select id into v_owner from auth.users order by created_at asc limit 1;
  if v_owner is null then
    raise exception
      'No auth users found. Sign up once in the app, then re-run supabase/seed.sql.';
  end if;

  -- Fresh start for the demo restaurant (cascades to its children).
  delete from public.restaurants where slug = 'demo';

  insert into public.restaurants
    (owner_id, name, slug, description, currency, default_locale, locales, is_published)
  values
    (v_owner, 'The Copper Fork', 'demo',
     'Modern Mediterranean plates, wood-fired mains and natural wines.',
     'USD', 'en', array['en','es','fr'], true)
  returning id into v_rest;

  -- ---- Categories -------------------------------------------------------
  insert into public.categories (restaurant_id, name, name_i18n, description, sort_order)
  values (v_rest, 'Starters',
          '{"es":"Entrantes","fr":"Entrées"}'::jsonb,
          'Small plates to share', 0)
  returning id into c_start;

  insert into public.categories (restaurant_id, name, name_i18n, description, sort_order)
  values (v_rest, 'Mains',
          '{"es":"Platos principales","fr":"Plats"}'::jsonb,
          'Wood-fired & slow-cooked', 1)
  returning id into c_mains;

  insert into public.categories (restaurant_id, name, name_i18n, description, sort_order)
  values (v_rest, 'Desserts',
          '{"es":"Postres","fr":"Desserts"}'::jsonb,
          'House-made, daily', 2)
  returning id into c_dessert;

  insert into public.categories (restaurant_id, name, name_i18n, description, sort_order)
  values (v_rest, 'Drinks',
          '{"es":"Bebidas","fr":"Boissons"}'::jsonb,
          'Cocktails & natural wines', 3)
  returning id into c_drinks;

  -- ---- Dishes -----------------------------------------------------------
  -- Photos are royalty-free Unsplash images (hotlinked for the demo only).

  insert into public.dishes
    (restaurant_id, category_id, name, name_i18n, description, price_cents,
     image_url, allergens, dietary_tags, is_available, is_featured, sort_order)
  values
    (v_rest, c_start, 'Tomato Bruschetta',
     '{"es":"Bruschetta de tomate","fr":"Bruschetta à la tomate"}'::jsonb,
     'Grilled sourdough, heirloom tomato, basil, aged balsamic.', 1100,
     'https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=800&q=80',
     array['gluten'], array['vegetarian','vegan'], true, false, 0)
  returning id into d_bruschetta;

  insert into public.dishes
    (restaurant_id, category_id, name, description, price_cents,
     image_url, allergens, dietary_tags, is_available, is_featured, sort_order)
  values
    (v_rest, c_start, 'Crispy Calamari',
     'Lightly fried, lemon aioli, pickled chili.', 1600,
     'https://images.unsplash.com/photo-1604909052743-94e838986d24?w=800&q=80',
     array['gluten','shellfish','eggs'], array['spicy'], true, false, 1)
  returning id into d_calamari;

  insert into public.dishes
    (restaurant_id, category_id, name, description, price_cents,
     image_url, allergens, dietary_tags, is_available, is_featured, sort_order)
  values
    (v_rest, c_start, 'Burrata & Peach',
     'Creamy burrata, grilled peach, prosciutto, mint.', 1800,
     'https://images.unsplash.com/photo-1608897013039-887f21d8c804?w=800&q=80',
     array['dairy'], array['gluten-free','chef-special'], true, true, 2)
  returning id into d_burrata;

  insert into public.dishes
    (restaurant_id, category_id, name, name_i18n, description, price_cents,
     image_url, allergens, dietary_tags, is_available, is_featured, sort_order)
  values
    (v_rest, c_mains, 'Wood-Fired Ribeye',
     '{"es":"Chuletón a la brasa","fr":"Entrecôte au feu de bois"}'::jsonb,
     '12oz dry-aged ribeye, bone marrow butter, chimichurri.', 4200,
     'https://images.unsplash.com/photo-1546964124-0cce460f38ef?w=800&q=80',
     array['dairy'], array['gluten-free','chef-special'], true, true, 0)
  returning id into d_ribeye;

  insert into public.dishes
    (restaurant_id, category_id, name, description, price_cents,
     image_url, allergens, dietary_tags, is_available, is_featured, sort_order)
  values
    (v_rest, c_mains, 'Grilled Atlantic Salmon',
     'Charred salmon, salsa verde, roasted fennel.', 2900,
     'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=800&q=80',
     array['fish'], array['gluten-free','dairy-free'], true, false, 1)
  returning id into d_salmon;

  insert into public.dishes
    (restaurant_id, category_id, name, description, price_cents,
     image_url, allergens, dietary_tags, is_available, is_featured, sort_order)
  values
    (v_rest, c_mains, 'Wild Mushroom Risotto',
     'Carnaroli rice, porcini, parmesan, truffle oil.', 2400,
     'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=800&q=80',
     array['dairy'], array['vegetarian','gluten-free'], true, false, 2)
  returning id into d_risotto;

  -- 86'd dish: sold out for the night (is_available = false).
  insert into public.dishes
    (restaurant_id, category_id, name, description, price_cents,
     image_url, allergens, dietary_tags, is_available, is_featured, sort_order)
  values
    (v_rest, c_mains, 'Pan-Seared Sea Bass',
     'Whole sea bass, brown butter, capers, charred lemon.', 3400,
     'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=800&q=80',
     array['fish'], array['gluten-free'], false, false, 3)
  returning id into d_seabass;

  insert into public.dishes
    (restaurant_id, category_id, name, description, price_cents,
     image_url, allergens, dietary_tags, is_available, is_featured, sort_order)
  values
    (v_rest, c_dessert, 'Classic Tiramisu',
     'Espresso-soaked savoiardi, mascarpone, cocoa.', 1200,
     'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=800&q=80',
     array['dairy','eggs','gluten'], array['vegetarian'], true, false, 0)
  returning id into d_tiramisu;

  -- ---- Drinks -----------------------------------------------------------
  insert into public.dishes
    (restaurant_id, category_id, name, description, price_cents,
     image_url, allergens, dietary_tags, is_available, is_featured, sort_order)
  values
    (v_rest, c_drinks, 'Negroni',
     'Gin, Campari, sweet vermouth, orange.', 1400,
     'https://images.unsplash.com/photo-1551734413-5f9d5a5a5c1a?w=800&q=80',
     array[]::text[], array['vegan','gluten-free'], true, false, 0)
  returning id into d_negroni;

  insert into public.dishes
    (restaurant_id, category_id, name, description, price_cents,
     image_url, allergens, dietary_tags, is_available, is_featured, sort_order)
  values
    (v_rest, c_drinks, 'Chianti Classico',
     'Sangiovese, Tuscany — glass.', 1300,
     'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80',
     array['sulphites'], array['vegan'], true, false, 1)
  returning id into d_chianti;

  insert into public.dishes
    (restaurant_id, category_id, name, description, price_cents,
     image_url, allergens, dietary_tags, is_available, is_featured, sort_order)
  values
    (v_rest, c_drinks, 'Aperol Spritz',
     'Aperol, prosecco, soda, orange.', 1200,
     'https://images.unsplash.com/photo-1560512823-829485b8bf24?w=800&q=80',
     array['sulphites'], array['vegan','gluten-free'], true, false, 2)
  returning id into d_spritz;

  -- ---- Pairings (upsell engine) ----------------------------------------
  -- "Goes well with" (kind = 'pairing') and add-ons (kind = 'addon').
  insert into public.dish_pairings (restaurant_id, dish_id, paired_dish_id, kind) values
    (v_rest, d_ribeye,     d_chianti,    'pairing'),   -- steak + red wine
    (v_rest, d_ribeye,     d_burrata,    'pairing'),
    (v_rest, d_salmon,     d_spritz,     'pairing'),
    (v_rest, d_risotto,    d_negroni,    'pairing'),
    (v_rest, d_bruschetta, d_spritz,     'pairing'),
    (v_rest, d_calamari,   d_negroni,    'pairing'),
    (v_rest, d_tiramisu,   d_negroni,    'addon'),
    (v_rest, d_burrata,    d_chianti,    'pairing');

  raise notice 'Seeded demo restaurant "The Copper Fork" at /m/demo (owner=%).', v_owner;
end $$;
