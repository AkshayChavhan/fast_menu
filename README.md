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

---

## Quick start

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

In your Supabase project's **SQL Editor**, run the schema:

```
supabase/schema.sql
```

This creates the tables, Row-Level Security policies, the `menu-images` storage
bucket, and a trigger that provisions a starter restaurant for every new user.

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

| Command             | Description                          |
| ------------------- | ------------------------------------ |
| `npm run dev`       | Start the dev server                 |
| `npm run build`     | Production build                     |
| `npm run start`     | Serve the production build           |
| `npm run lint`      | ESLint                               |
| `npm run typecheck` | TypeScript, no emit                  |

---

## Project structure

```
src/
  app/
    page.tsx              Marketing landing page
    (auth)/               Login & signup (route group)
    auth/                 Signout + email-confirm route handlers
    dashboard/            Owner app: overview, menu editor, settings, QR
      menu/actions.ts     Server Actions (category/dish CRUD, 86 toggle)
      settings/actions.ts Server Actions (restaurant settings, publish)
    m/[slug]/             Public customer-facing menu
    api/qr/               PNG QR-code endpoint
  components/
    menu/                 Public menu UI (dish cards, pairings, language switcher)
    dashboard/            Editor UI (dish form, chips, switch, image upload)
    qr/QrStudio.tsx       QR generation + printable assets
    Wordmark.tsx          Shared logo lockup
  lib/
    supabase/             Browser / server / middleware clients
    site.ts               Absolute-URL helpers (origin, public menu path)
    utils.ts              formatPrice, slugify, localized, cn
    constants.ts          Allergens, dietary tags, locales, currencies
  types/db.ts             Domain types mirroring the schema
supabase/
  schema.sql              Tables, RLS, storage bucket, triggers
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
