# Plans and features

What a restaurant gets on each plan, what it costs, and where in the code
each rule is enforced. The source of truth is `src/lib/plans.ts` (what a
plan allows), `src/lib/payments/razorpay.ts` (what is charged) and
`supabase/migrations/*_plans.sql` / `*_plan_grace.sql` (what the database
refuses). If this page and the code disagree, the code is right — fix the page.

## The plans

| | Price | Term | Behaves as |
|---|---|---|---|
| **Free trial** | ₹0 | 15 days from claiming | Pro |
| **Starter** | ₹2,000 | per year | Starter |
| **Pro** | ₹5,000 | per year | Pro |

Two plans are sold, both annual (one Razorpay purchase = 12 months). There is
no free-forever tier. The trial runs as Pro so an owner feels the ordering
system before paying.

**When a term ends.** The restaurant drops to Starter rules at once —
ordering stops — but the public menu stays readable for a **30-day grace
period** (`PLAN_GRACE_DAYS`). QR codes are printed and glued to tables, so a
lapsed card must not be a dinner-service outage. After grace, the menu goes
dark until they pay or a project owner grants a plan from `/admin/plans`.

**Trial length.** A restaurant row is created with a 14-day trial and the
claim page resets it to 15 days from claiming. Quote 15.

## Features by plan

Starter is *the menu*. Pro is *everything that runs the floor*. Every gated
feature is a Pro feature; there is nothing Starter has that Pro lacks.

### Public menu — `/m/{slug}` (what guests see)

| Feature | Starter | Pro |
|---|---|---|
| QR menu: categories, dishes, photos, allergens, dietary tags | ✓ | ✓ |
| Sizes and add-ons, pairings, featured dishes, sold-out toggle | ✓ | ✓ |
| Languages on the menu | **2** | all 19 |
| Guest reviews and the restaurant's Google review link | ✓ | ✓ |
| Order from the table: cart, place order, live order status | — | ✓ |
| Call waiter / request bill | — | ✓ |
| No "fast_menu" footer on the menu (white label) | — | ✓ |

### Owner dashboard — `/dashboard/*`

| Page | Starter | Pro |
|---|---|---|
| Overview | ✓ | ✓ |
| Menu editor | ✓ | ✓ |
| — Date-ranged daily specials | — | ✓ |
| Import / export the whole menu | ✓ | ✓ |
| Preview & QR: the menu QR | ✓ | ✓ |
| — Per-table QR sheets | — | ✓ |
| Reviews and the review form | ✓ | ✓ |
| Settings: name, slug, currency, logo, publish | ✓ | ✓ |
| — Ordering switches: enable ordering, takeaway, pause, kitchen screen | — | ✓ |
| Orders and the billing counter | — | ✓ |
| Insights: sales by day, busiest hours, best sellers | — | ✓ |
| Schedules: breakfast / lunch / dinner menus | — | ✓ |
| Tables: floor plan, retire, print | — | ✓ |
| Staff logins (manager, cashier, waiter, kitchen) | owner only | up to **10** |
| Upgrade page and Razorpay checkout | ✓ | ✓ |

### Staff apps

| App | Starter | Pro |
|---|---|---|
| Waiter app `/waiter`: scan, approve, take, edit and move orders, table board, push alerts | — | ✓ |
| Kitchen screen `/kitchen` | — | ✓ |

Both need a staff login, which only Pro can create.

### Not plan features

The operator pages under `/admin` — activity, plans, trial reviews, leads
and the JSON import, payments, admins, the read-only restaurant page — are
gated by `platform_admins`, not by any restaurant's plan. Restaurants never
see them. See `docs/SETUP.md` §6.

## How the gates work

The five feature flags are `ordering`, `staff`, `schedules`, `languages`
and `white_label` (`PLAN_FEATURES`). Starter has none; Pro has all. The
map is a set rather than a boolean so a middle tier can be added later
without touching call sites.

Three layers, from softest to hardest:

1. **Sidebar** (`components/dashboard/SidebarNav.tsx`). On Starter, the
   Orders, Insights, Schedules, Tables and Staff rows are shown greyed with
   a *Pro* badge and link to the upgrade page. Never hidden: the badge is
   the upsell.
2. **Server actions** (`app/dashboard/lib.ts` → `requirePlanFeature`).
   Every mutation behind a gate re-checks the plan on the server and
   returns the matching line from `UPGRADE_PROMPTS`.
3. **Database.** Anything that creates work or money for the restaurant is
   refused inside Postgres, because the anon key is in every guest's
   browser and UI gating alone is bypassable:
   - `place_order()` — a guest ordering
   - `staff_create_order()` — a waiter ordering
   - `create_service_request()` — call waiter / request bill
   - `restaurants_public.hide_branding` — the footer, computed in the view

All three read `restaurant_plan()`, which mirrors `effectivePlan()` in
TypeScript: a Pro row past its expiry is Starter; a restaurant inside its
trial is Pro whatever the column says. Keep the two in step.

### Limits

| Limit | Starter | Pro | Where |
|---|---|---|---|
| Languages | 2 (`STARTER_LOCALE_LIMIT`) | unlimited | `localeLimit()` |
| Active staff, not counting the owner | 0 | 10 (`PRO_STAFF_LIMIT`) | `staffLimit()` |
| Grace after lapse | 30 days | 30 days | `PLAN_GRACE_DAYS` / `plan_grace()` |

A cap can always be raised as a gift; lowering one costs customers.

## Changing a price or a plan

- **Price:** change `PLAN_PRICE_PAISE` in `src/lib/payments/razorpay.ts`
  and `PLAN_PRICE_LABELS` in `src/lib/plans.ts`. `plans.test.ts` holds the
  two to each other, so forgetting one fails the build.
- **What a plan includes:** `PLAN_INCLUDES` in `src/lib/plans.ts` feeds both
  the public pricing section and the upgrade page, so they cannot disagree.
- **Granting a plan by hand:** `/admin/plans` (project owner). Terms are set
  in months and extend from whichever is later, today or the current
  expiry, so renewing early adds to the term instead of shortening it.
- **A new tier:** add it to `PLANS`, give it a set in `GRANTS`, a price, a
  label and an includes list, and extend `restaurant_plan()` in a new
  migration. The call sites need no change.

## A note on Insights

Insights is listed under Pro and gated on the `ordering` flag rather than
its own: without ordering there is nothing to chart. If Insights is ever to
be sold on its own, give it a flag of its own first.
