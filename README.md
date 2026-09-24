# fast_menu

**QR digital menus for hospitality** — hotels, restaurants, cafés & bars.

Mobile-first menus your guests scan at the table: photos, allergens, dietary
tags, and upsell pairings. Owners edit prices or **86 a dish from their phone**
— no reprints. Multi-language for hotels, with printable table tents, stickers
& window decals.

Built with **Next.js 16 (App Router) · TypeScript · Tailwind CSS · Supabase**
(Postgres + Auth + Storage).

---

## Features

- **Public menu** (`/m/<slug>`) — mobile-first, photos, allergen badges, dietary
  filters, per-locale language switcher, and "goes well with" upsell pairings.
- **Owner dashboard** (`/dashboard`) — manage categories & dishes, upload photos,
  set prices, tag allergens/diets, and flip the **86 toggle** to mark a dish
  unavailable instantly.
- **Settings** — restaurant name, public URL slug, currency, and the languages
  your menu is offered in; publish/unpublish the menu.
- **QR studio** (`/dashboard/qr`) — generate the menu QR, download PNG/SVG, and
  print ready-made table tents, sticker sheets and window decals.
- **Marketing landing page** (`/`) with a live demo link.
- **Multi-tenant & secure** — every restaurant is isolated by Postgres
  Row-Level Security; owners can only touch their own data.
- **Roles & staff logins** — owner, manager, cashier, waiter and kitchen. One
  login page sends each role to its app; the dashboard shows each role only
  what it may use.
- **One trial per hotel** — a 15-day trial claimed once with a verified mobile
  number, GSTIN and name + pincode checks, and a platform-admin review queue
  for look-alikes.
- **Sizes, variants & add-ons** — half / full plates, spice levels, extra
  toppings, defined per dish by the owner; the public menu shows "from" prices.
- **Schedules & daily specials** — breakfast / lunch / happy-hour windows in
  the restaurant's timezone, and date-limited specials highlighted on the menu.
- **Tables & per-table QR** — a floor plan with a stable code per table, so
  guests scan the table they sit at and the label can change without reprints.
- **Ordering switches** — accept orders, takeaway, per-table QR, kitchen screen
  and a one-tap pause with a message guests see.
- **Guest ordering** (`/m/<slug>/cart`, `/m/<slug>/order/<code>`) — no login:
  add dishes with sizes and add-ons, notes, dine-in or parcel, place the order
  and show its QR to the waiter; the page tracks approval, the table and the
  bill, then points at Google reviews. Call a waiter or ask for the bill from
  a table QR. Every price is re-read by the database; anonymous writes go
  through security-definer functions and are rate-limited.

---

## Quick start

> **New to Supabase?** Follow the click-by-click **[Setup Walkthrough](docs/SETUP.md)**
> instead — it covers every step below in detail with troubleshooting.

### 1. Prerequisites

- Node.js 20+ and npm
- A free [Supabase](https://supabase.com) project

### 2. Install

```bash
git clone https://github.com/AkshayChavhan/fast_menu.git
cd fast_menu
npm install
```

### 3. Configure the database

In your Supabase project's **SQL Editor**, run every file in
`supabase/migrations/` in filename order (or `supabase db push` with the
Supabase CLI):

```
supabase/migrations/20260924000000_baseline.sql
supabase/migrations/<later files, in order>
```

The baseline creates the tables, Row-Level Security policies, the `menu-images`
storage bucket, and a trigger that provisions a starter restaurant for every
new user. Each later file is a forward-only migration that adds one feature and
is safe to run once on an existing database.

### 4. Environment variables

Copy the template and fill in your project's API keys
(Supabase → **Project Settings → API**):

```bash
cp .env.example .env.local
```

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # server-only, never exposed
NEXT_PUBLIC_SITE_URL=http://localhost:3000        # used for QR / share links
```

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. Click **Get started** → sign up.
2. You'll land in the dashboard with a starter restaurant already created.
3. Build your menu, then **Publish** it under Settings.
4. Grab your QR under **QR** and preview your public menu at `/m/<your-slug>`.

> If email confirmation is enabled in Supabase, confirm via the emailed link
> (or disable **Confirm email** under Supabase → Authentication → Providers for
> local development).

### 6. (Optional) Load the demo menu

Want the landing page's **"See a live demo"** link (`/m/demo`) to work with a
fully-populated menu? After signing up once, run the seed in the SQL Editor:

```
supabase/seed.sql
```

It creates a published demo restaurant — *The Copper Fork* — at `/m/demo` with
categories, photographed dishes, allergens, dietary tags, a sold-out (86'd)
dish, multi-language names, and upsell pairings. Re-running it resets the demo.
(It attaches the demo to your first signed-up user, since every restaurant needs
an owner.)

---

## Scripts

| Command              | Description                                 |
| -------------------- | ------------------------------------------- |
| `pnpm dev`           | Start the dev server                        |
| `pnpm build`         | Production build                            |
| `pnpm start`         | Serve the production build                  |
| `pnpm lint`          | ESLint                                      |
| `pnpm typecheck`     | TypeScript, no emit                         |
| `pnpm test`          | Unit tests (Vitest), once                   |
| `pnpm test:watch`    | Unit tests in watch mode                    |
| `pnpm test:sql`      | SQL tests against a throwaway Postgres      |

---

## Tests

### `pnpm test` — Vitest

Test files sit next to the code they cover, as `*.test.ts` / `*.test.tsx`.
Pure logic runs in Node; files that need a DOM opt in with an
`// @vitest-environment jsdom` docblock at the top.

What's covered:

| Area | File |
| ---- | ---- |
| Menu import/export parsing, normalisation, round-trip (incl. modifiers, specials, schedules) | `src/lib/menu-import.test.ts` |
| Variant / add-on pricing and validation | `src/lib/modifiers.test.ts` |
| Schedule windows and special dates in a timezone | `src/lib/schedule.test.ts` |
| Table label ranges and ordering | `src/lib/tables.test.ts` |
| Google review link validation | `src/lib/google-review.test.ts` |
| Guest cart: line keys, merging, quantities, totals, order payload | `src/lib/cart.test.ts` |
| Review settings + rating normalisation | `src/lib/reviews.test.ts` |
| Price, slug and translation helpers | `src/lib/utils.test.ts` |
| Site origin resolution | `src/lib/site.test.ts` |
| Blob file downloads | `src/lib/download-file.test.ts` |
| Public review submission (validation + sanitisation) | `src/app/r/[slug]/actions.test.ts` |
| Star rating: mouse, keyboard, ARIA | `src/components/reviews/StarRating.test.tsx` |
| Sidebar navigation, Review submenu, per-role visibility | `src/components/dashboard/SidebarNav.test.tsx` |
| Role → capability map | `src/lib/permissions.test.ts` |
| Staff account actions (validation, role rules, cleanup on failure) | `src/app/dashboard/staff/actions.test.ts` |

### `pnpm test:sql` — database functions

`import_menu()` replaces a whole menu in one transaction, so it's tested for
real rather than mocked. `scripts/test-sql.sh` spins up a throwaway PostgreSQL
cluster in a temp directory, mirrors the tables the function touches
(`supabase/tests/fixtures.sql`), extracts the function **straight out of
`supabase/migrations/`** so the tests can't drift from the shipped code, and runs
`supabase/tests/import_menu.test.sql`. The cluster is deleted on exit and your
own PostgreSQL is never started.

It needs the Postgres client binaries on `PATH`:

```bash
brew install postgresql@14
export PATH="$(brew --prefix postgresql@14)/bin:$PATH"
pnpm test:sql
```

Beyond field fidelity and ordering, it asserts the two properties that make the
import safe: a non-owner is refused with `42501`, and a failure induced *after*
the deletes have been applied rolls back completely, leaving the original menu
intact.

`supabase/tests/claim_trial.test.sql` covers the one-trial-per-hotel rules the
same way: phone and GSTIN duplicates are refused, a look-alike name in the same
pincode is parked for review, publishing is blocked until the trial is active,
and only platform admins can approve or deny. `set_dish_modifiers.test.sql`
and `schedules.test.sql` do the same for variants / add-ons and for schedule
windows, including overnight and timezone edges. `orders.test.sql` exercises the
guest ordering functions: price snapshots, size and add-on validation, refusals
when paused or unavailable, one unapproved order per device, expiry, guest
cancellation, session totals, service requests and the rate limiter.

### Not covered

Server actions that only orchestrate Supabase calls, the dashboard editor
components, and RLS policies have no automated tests — the first two are thin,
and RLS needs a real Supabase project to exercise meaningfully.

---

## Project structure

```
src/
  app/
    page.tsx              Marketing landing page
    (auth)/               Login & signup (route group)
    auth/                 Signout + email-confirm route handlers
    dashboard/            Back office: overview, menu, schedules, tables, staff, settings, QR
      menu/actions.ts     Server Actions (category/dish CRUD, 86 toggle)
      settings/actions.ts Server Actions (restaurant settings, publish)
    m/[slug]/             Public customer-facing menu, cart and live order page
    api/qr/               PNG QR-code endpoint
    waiter/               Waiter app shell (phone)
    kitchen/              Kitchen screen shell (tablet)
    onboarding/claim/     One-time trial claim (phone OTP, GSTIN, pincode)
    admin/trials/         Platform-admin review of flagged trials
  components/
    menu/                 Public menu UI (dish cards, pairings, language switcher)
    dashboard/            Editor UI (dish form, chips, switch, image upload)
    qr/QrStudio.tsx       QR generation + printable assets
    Wordmark.tsx          Shared logo lockup
  lib/
    supabase/             Browser / server / proxy / admin clients
    membership.ts         Who is signed in, where they work, as what role
    permissions.ts        Role → capability map (mirrors the RLS rules)
    site.ts               Absolute-URL helpers (origin, public menu path)
    utils.ts              formatPrice, slugify, localized, cn
    constants.ts          Allergens, dietary tags, locales, currencies
  types/db.ts             Domain types mirroring the schema
supabase/
  migrations/             Versioned schema: baseline + one file per feature
  seed.sql                Demo restaurant for /m/demo
```

---

## Data model

- **restaurants** — the tenant. `slug` is the public URL segment; `is_published`
  gates public visibility; `locales[]` lists offered languages.
- **categories** / **dishes** — the menu. Prices are stored as integer
  `price_cents`. `is_available = false` is the **86'd** state. Translations live
  in `*_i18n` JSONB columns.
- **dish_pairings** — the upsell engine ("goes well with" / add-ons).
- **restaurant_staff** — manager, cashier, waiter and kitchen logins; the owner
  is `restaurants.owner_id`. `member_role()` answers role questions inside RLS.
- **trial_claims** — one row per hotel that activated its trial (phone hash,
  GSTIN, normalised name + pincode), so a second email cannot earn a second
  trial.

All access is enforced by Postgres RLS: owners manage their own rows; the public
can only read rows belonging to a **published** restaurant.

---

## Deploy

Deploy to [Vercel](https://vercel.com): import the repo, add the four
environment variables above (set `NEXT_PUBLIC_SITE_URL` to your production URL),
and ship. Point your Supabase Auth **Site URL** / redirect URLs at the deployed
domain.

---

## License

MIT
