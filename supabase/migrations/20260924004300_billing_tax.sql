-- ============================================================================
-- Bill & taxes: what a restaurant adds on top of its dish prices.
--
-- The owner sets these under Settings -> Bill & taxes. This migration only
-- stores them; lib/bill-tax.ts is the one place the arithmetic lives, and a
-- later change applies it to bills (snapshotted at settlement, so a rate
-- change never rewrites an old bill).
--
--   tax_mode            'none'         not registered for GST: no tax lines
--                       'gst'          regular GST, split CGST + SGST
--                       'composition'  composition scheme: GST may NOT be
--                                      collected from guests; the bill says so
--   gst_rate_bp         the GST rate in basis points (500 = 5%). 5% is the
--                       rate for most restaurants; 18% applies inside hotels
--                       with rooms above Rs 7,500 a night ("specified
--                       premises"). Owners confirm theirs with their CA.
--   prices_include_tax  menu prices already include the taxes (tax is worked
--                       back out of them) or exclude them (tax is added).
--   liquor_vat_bp       state VAT on alcohol, which is outside GST. Applies to
--                       categories marked tax_class = 'liquor'.
--   packaging_cents     a flat charge added to takeaway orders.
--   round_off           round the total to the nearest rupee.
--
-- There is deliberately no service charge: under the CCPA guidelines (upheld
-- by the Delhi High Court in 2025) it may not be added automatically.
--
-- gstin already exists (from the trial claim). It is not in
-- restaurants_public; the guest-facing bill will read it through a function.
-- ============================================================================

alter table public.restaurants
  add column if not exists tax_mode           text    not null default 'none',
  add column if not exists gst_rate_bp        integer not null default 500,
  add column if not exists prices_include_tax boolean not null default false,
  add column if not exists liquor_vat_bp      integer not null default 0,
  add column if not exists packaging_cents    integer not null default 0,
  add column if not exists round_off          boolean not null default true;

do $checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_tax_mode_check') then
    alter table public.restaurants add constraint restaurants_tax_mode_check
      check (tax_mode in ('none', 'gst', 'composition'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurants_gst_rate_bp_check') then
    alter table public.restaurants add constraint restaurants_gst_rate_bp_check
      check (gst_rate_bp between 0 and 2800);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurants_liquor_vat_bp_check') then
    alter table public.restaurants add constraint restaurants_liquor_vat_bp_check
      check (liquor_vat_bp between 0 and 5000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurants_packaging_cents_check') then
    alter table public.restaurants add constraint restaurants_packaging_cents_check
      check (packaging_cents between 0 and 100000);
  end if;
end
$checks$;

-- Food is taxed with GST; liquor with the state's VAT.
alter table public.categories
  add column if not exists tax_class text not null default 'food';

do $checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'categories_tax_class_check') then
    alter table public.categories add constraint categories_tax_class_check
      check (tax_class in ('food', 'liquor'));
  end if;
end
$checks$;

-- Make the API see the new columns straight away.
notify pgrst, 'reload schema';
