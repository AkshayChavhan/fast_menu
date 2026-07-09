# fast_menu — Setup Walkthrough

A step-by-step guide to get fast_menu running locally, from zero to a working
menu. Takes ~10 minutes. No prior Supabase experience needed.

You'll do four things:

1. [Create a Supabase project](#1-create-a-supabase-project)
2. [Run the database schema](#2-run-the-database-schema)
3. [Wire up environment variables](#3-wire-up-environment-variables)
4. [Run the app & create your first menu](#4-run-the-app)

Then, optionally, [load the demo menu](#5-optional-load-the-demo-menu) so
`/m/demo` works.

---

## Prerequisites

- **Node.js 20 or newer** — check with `node --version`
- **A [Supabase](https://supabase.com) account** — free, sign up with GitHub or email
- The repo cloned and dependencies installed:

  ```bash
  git clone https://github.com/AkshayChavhan/fast_menu.git
  cd fast_menu
  npm install
  ```

---

## 1. Create a Supabase project

1. Go to **https://supabase.com/dashboard** and sign in.
2. Click **New project**.
3. Fill in:
   - **Name**: `fast-menu` (anything)
   - **Database Password**: click **Generate a password** and save it somewhere
     (you won't need it for this app, but Supabase requires one).
   - **Region**: pick the one closest to you.
4. Click **Create new project** and wait ~2 minutes while it provisions.

---

## 2. Run the database schema

This creates all tables, security policies, the image storage bucket, and a
trigger that gives every new signup a starter restaurant.

1. In your project, open the **SQL Editor** (left sidebar, the `</>` icon).
2. Click **+ New query**.
3. Open [`supabase/schema.sql`](../supabase/schema.sql) from this repo, copy its
   **entire** contents, and paste into the editor.
4. Click **Run** (or press Ctrl/Cmd + Enter).
5. You should see **Success. No rows returned** — that's correct.

> Re-running `schema.sql` later is safe; it uses `create ... if not exists` and
> `drop policy if exists`.

**Verify (optional):** open the **Table Editor** — you should now see the
`profiles`, `restaurants`, `categories`, `dishes`, and `dish_pairings` tables.

---

## 3. Wire up environment variables

The app needs your project's API URL and keys.

1. In Supabase, go to **Project Settings** (gear icon) → **API**.
2. You'll need three values from this page:
   - **Project URL** — under "Project URL" (looks like
     `https://abcdefgh.supabase.co`)
   - **anon public** key — under "Project API keys"
   - **service_role** key — under "Project API keys" (click to reveal). This is
     secret — treat it like a password.

3. In the repo, create your local env file from the template:

   ```bash
   cp .env.example .env.local
   ```

4. Open `.env.local` and fill in the values:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...   # the anon public key
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...        # the service_role key
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

> `.env.local` is gitignored — your secrets never get committed. That's why it
> isn't in the repo and you create it yourself.

### (Recommended for local dev) turn off email confirmation

By default Supabase emails a confirmation link on signup. For local testing it's
easier to skip it:

1. Go to **Authentication** → **Sign In / Providers** → **Email**.
2. Turn **off** "Confirm email".
3. Save.

Now signups log you straight in. (Leave it **on** for production.)

---

## 4. Run the app

```bash
npm run dev
```

Open **http://localhost:3000**.

1. Click **Get started** and sign up with any email + password.
2. You land in the **dashboard** — a starter restaurant ("My Restaurant") was
   created for you automatically.
3. Go to **Settings**: set your restaurant name, a URL **slug** (e.g.
   `bella-italia`), currency, and languages. Toggle **Publish** on.
4. Go to **Menu**: add categories and dishes, set prices, tag allergens, upload
   photos, and try the **86 toggle** to mark a dish sold-out.
5. Go to **QR**: download your QR code or print a table tent.
6. Visit your live public menu at **http://localhost:3000/m/your-slug**.

That's it — you have a working QR menu. 🎉

---

## 5. (Optional) Load the demo menu

The landing page's **"See a live demo"** button links to `/m/demo`. To make it
show a fully-populated example menu:

1. Make sure you've **signed up at least once** (step 4) — the demo needs a user
   to own it.
2. In Supabase **SQL Editor**, open a new query, paste the contents of
   [`supabase/seed.sql`](../supabase/seed.sql), and **Run**.
3. Visit **http://localhost:3000/m/demo** — you'll see *The Copper Fork* with
   categories, photos, allergens, a sold-out dish, multiple languages, and
   upsell pairings.

Re-running `seed.sql` resets the demo to a clean state.

---

## Troubleshooting

| Symptom | Cause & fix |
| --- | --- |
| Pages error / "Invalid API key" | `.env.local` values are wrong or missing. Double-check the URL and anon key, then restart `npm run dev`. |
| Signup "succeeds" but you're not logged in | Email confirmation is on. Either click the emailed link, or turn off "Confirm email" (step 3). |
| Public menu shows "menu not found" | The restaurant isn't **published**, or the slug in the URL doesn't match. Publish it under Settings. |
| Dish photos don't upload | The `menu-images` storage bucket wasn't created — re-run `schema.sql`. |
| `/m/demo` is empty / errors | You ran `seed.sql` before signing up. Sign up first, then re-run the seed. |
| Env changes not taking effect | Restart the dev server — Next.js only reads `.env.local` at startup. |

---

## Going to production (Vercel)

1. Push your repo to GitHub (already done for this project).
2. Import it at **https://vercel.com/new**.
3. Add the same four environment variables in Vercel's project settings, but set
   `NEXT_PUBLIC_SITE_URL` to your real deployed URL (e.g.
   `https://fast-menu.vercel.app`).
4. In Supabase → **Authentication** → **URL Configuration**, set the **Site URL**
   and add your deployed domain to **Redirect URLs**.
5. Deploy.
