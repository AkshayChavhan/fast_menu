# Table ordering — implementation plan

fast_menu grows from a QR menu into table ordering with five roles. This is
the working plan for the `feat/table-ordering` branch: what is being built,
the decisions behind it, and a checklist that is ticked as each phase lands.
Every phase ships as small, topic-sized commits so a regression can be
bisected to one idea.

## Roles

| Role | Where | Can |
| --- | --- | --- |
| Owner | `/dashboard` | Everything, including settings, trial and integrations |
| Manager | `/dashboard` | Menu, variants, specials, schedules, disable items, pause ordering, tables, staff below manager, billing |
| Cashier | `/dashboard` | Billing counter and history only |
| Waiter | `/waiter` | Scan, approve, reject, take and edit orders, table board, service requests |
| Kitchen | `/kitchen` | Kitchen ticket screen (only when the admin switches it on) |

One login page routes each role to its home. The owner is the restaurant's
`owner_id`; every other role is a row in `restaurant_staff`. Authorization
reads that table through `member_role()`, never JWT metadata. Managers are the
supported way for one hotel to have several logins.

## Flow

1. **Customer** scans the table QR (per-table when enabled, else the menu QR),
   adds dishes (variants and add-ons from a bottom sheet, item notes), picks
   dine-in or parcel, places the order. A security-definer function re-reads
   prices, snapshots names and prices, and returns a short code. Status:
   `placed`.
2. The order page shows a QR encoding the waiter scan URL plus the code as
   text. It polls for status.
3. **Waiter** scans (or types the code), edits items if asked, enters or
   confirms the table, approves. Status: `approved`. Approving attaches the
   order to the table's open session or opens one. Waiters can also take an
   order directly; those are created as `approved`.
4. **Billing** (owner, manager or cashier) sees open sessions grouped by
   table, with items and totals. Mark paid settles the session and every order
   in it. Only approved orders ever reach billing.
5. **Kitchen**, when enabled, works tickets per order with item states
   queued, preparing, ready, served. Ready notifies the approving waiter.

Status flow: `placed` → `approved` → `settled`; side exits `rejected`
(waiter, from placed), `cancelled` (waiter, from approved; customer, from
placed). Placed orders expire after two hours.

## Data model

| Table | Purpose |
| --- | --- |
| `restaurant_staff` | user, role, display name, active flag; one restaurant per staff user |
| `tables` | label, stable `qr_token`, sort, active. Labels change without reprinting |
| `table_sessions`, `table_session_tables` | open / bill_requested / closed; joined tables; total, paid_at, paid_by |
| `orders` | code, status, source (customer/waiter), service_type (dine_in/takeaway), table, session, note, subtotal, created/approved/edited by |
| `order_items` | dish, name, unit price, variant + add-on snapshots, note, quantity, line total, kds_status |
| `order_events` | append-only audit trail |
| `modifier_groups`, `modifier_options` | per-dish variants and add-ons; required/min/max; option price, availability |
| `menu_schedules` | days of week + time window; categories reference one |
| `service_requests` | call waiter / request bill per table |
| `push_subscriptions` | Web Push endpoint per user |
| `rate_limit_buckets` | key, window, count |
| `trial_claims` | phone hash, normalized name + pincode, GSTIN |

`restaurants` gains `timezone`, `ordering_enabled`, `ordering_paused`,
`pause_message`, `table_qr_enabled`, `kds_enabled`, `allow_takeaway`,
`google_review_url`, phone/GSTIN/city/pincode and `trial_status`; the trial
default becomes 15 days. Dishes gain `special_from` / `special_until`.

## Security

- Anonymous users have **no direct table policies** on order data. They call
  security-definer functions: `place_order`, `get_order_by_code`,
  `cancel_order_by_code`, `create_service_request`.
- Staff call `staff_create_order`, `staff_set_order_items`, `approve_order`,
  `settle_session`. All item writes go through one shared helper that
  validates dish, variant, add-ons, availability, schedule and pause, and
  snapshots prices from the database.
- Waiter RLS on `orders`: old row `placed` or `approved`; new row `approved`,
  `rejected` or `cancelled`; nothing once settled. Item writes by staff only
  through functions. A trigger keeps `subtotal_cents` correct.
- Rate limiting: per-IP bucket, cap on unapproved orders per restaurant, one
  active placed order per device, expiry of stale placed orders.
- Trial: phone OTP at signup (one trial per verified number), `claim_trial`
  refuses exact phone/GSTIN matches and flags fuzzy name + pincode matches
  for review by a platform admin (email allowlist).

## Platform practices

- Schema lives in `supabase/migrations/` (Supabase CLI naming). The baseline
  is the former `schema.sql`; each feature adds one forward-only migration
  that is safe to run on an existing production database.
- `middleware.ts` → `proxy.ts` (Next.js 16 convention).
- Order pages opt out of the public menu's cache. Schedules and reports use
  the restaurant's timezone.
- Push is sent via `after()` so responses never wait on delivery.
- Sentry via `@sentry/nextjs` + `instrumentation.ts` `onRequestError`.
- Playwright end-to-end suite runs in CI against a local Supabase stack.

## Phases and progress

Tick a box when the phase is merged into this branch.

- [x] **0 Foundations** — plan doc, proxy rename, migrations, restaurant
      flags + timezone, `restaurant_staff` + `member_role`, permissions map,
      dashboard context by membership, 15-day trial.
- [x] **1 Accounts and trial** — staff management for all roles, role-based
      login routing, waiter/kitchen shells, phone OTP, trial claims + review.
- [x] **2 Admin menu upgrades** — tables + per-table QR, variants and
      add-ons in the dish form, schedules and specials, pause ordering,
      Google review link, import/export updated.
- [x] **3 Customer ordering** — cart, modifier sheet, item notes, dine-in or
      parcel, `place_order` + validation + rate limits, order page, table
      token, service requests.
- [x] **4 Waiter app** — scan, approve, reject, sessions and joined tables,
      composer for new and edited orders, home board and queues, order-more
      attach, push notifications.
- [x] **5 Billing counter** — sessions by table, Mark paid, history, cashier
      navigation, Realtime.
- [x] **6 Kitchen** — toggle, kitchen role and screen, item states, ready
      notifications, ticket print.
- [x] **7 Quality and launch** — Sentry, Playwright in CI, expiry cleanup,
      docs, demo seed, accessibility and performance pass.

## Decisions log

- 2026-09-24 — Orders are stored server-side at placement; the customer QR
  carries a short code, not the cart. Every order gets a code so waiter routes
  are uniform.
- 2026-09-24 — Billing settles table sessions, not single orders, so "order
  more", joined tables and the table board share one model.
- 2026-09-24 — A staff user belongs to exactly one restaurant; owners are
  separate. Keeps login routing a single lookup.
- 2026-09-24 — Managers cannot update `restaurants` directly; the few fields
  they may change (pause ordering) go through role-checked functions.
- 2026-09-24 — Sentry is wired in phase 7 rather than phase 0 so the build
  pipeline stays simple while the schema is changing fast.
- 2026-09-24 — Payment methods, discounts and tax are out of scope: Mark paid
  records the total only. `table_sessions.payment_method` exists for later.
- 2026-09-24 — Guests never get direct policies on order tables; every write
  is a security-definer function that re-reads prices. Staff have read
  policies only, and write through role-checked functions, so there is no
  update policy to get wrong.
- 2026-09-24 — Joined tables that already sit on two separate open bills are
  refused rather than merged; the waiter picks one.
- 2026-09-24 — The kitchen and the waiter's "Mark served" both move items;
  states only go forward except ready → preparing for a mistake.
- 2026-09-24 — End-to-end tests run in CI against `supabase start`; locally
  they need a running stack and the same env. Phone verification is switched
  to `none` on the test stack.
