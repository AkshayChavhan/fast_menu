import type { Metadata } from "next";
import { ExternalLink, Gauge } from "lucide-react";

import { requireProjectOwner } from "@/app/admin/lib";
import { AdminNav } from "@/components/admin/AdminNav";
import { Meter } from "@/components/admin/usage/Meter";
import { fetchGithubActionsUsage, type GithubActionsUsage } from "@/lib/github-usage";
import {
  formatBytes,
  formatCount,
  GITHUB_ACTIONS_FREE_MINUTES,
  monthsUntilFull,
  percentUsed,
  RAZORPAY_FEE_RATE,
  readInfraConfig,
  SENTRY_FREE_ERRORS,
  toneFor,
} from "@/lib/infra-limits";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Usage — fast_menu",
  robots: { index: false, follow: false },
};

interface Usage {
  generated_at: string;
  db_bytes: number;
  storage_bytes: number | null;
  storage_objects: number | null;
  order_bytes: number;
  bytes_per_order: number | null;
  tables: { name: string; bytes: number }[];
  counts: {
    restaurants: number;
    published: number;
    live: number;
    pro: number;
    dishes: number;
    images: number;
    staff: number;
    leads: number;
    orders_total: number;
    orders_30d: number;
    orders_month: number;
  };
  payments_month_paise: number;
}

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// Project-owner page: how much of each plan is used, what is left, and
// when it runs out at the current rate. The database is measured from
// inside; the vendors' own meters link to their dashboards.
export default async function UsagePage() {
  const { supabase, role } = await requireProjectOwner("/admin/usage");
  const config = readInfraConfig();

  const [usageRes, github] = await Promise.all([
    supabase.rpc("platform_usage"),
    fetchGithubActionsUsage().then(
      (u) => ({ ok: true as const, data: u }),
      (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "failed" }),
    ),
  ]);

  // The function came with the migration this page shipped in; a pending
  // migration is a notice, not an outage.
  let usage: Usage | null = null;
  let pendingMigration: string | null = null;
  if (usageRes.error) {
    if (usageRes.error.code === "PGRST202") pendingMigration = "20260924004000_platform_usage.sql";
    else throw new Error(`Failed to measure usage: ${usageRes.error.message}`);
  } else {
    usage = usageRes.data as Usage;
  }

  const { hosting, supabase: sb } = config;
  const monthlyUsd = hosting.priceUsd + sb.priceUsd;

  // Growth: what thirty days of orders added, projected forward.
  const growthPerMonth =
    usage && usage.bytes_per_order != null ? usage.bytes_per_order * usage.counts.orders_30d : null;
  const dbMonthsLeft = usage ? monthsUntilFull(usage.db_bytes, sb.database.limit, growthPerMonth) : null;
  const dbPct = usage ? percentUsed(usage.db_bytes, sb.database.limit) : null;
  const storagePct = usage ? percentUsed(usage.storage_bytes, sb.storage.limit) : null;
  const takingMoney = (usage?.payments_month_paise ?? 0) > 0 || (usage?.counts.pro ?? 0) > 0;

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <div className="flex items-center gap-2 text-brand-600">
            <Gauge className="h-5 w-5" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wide">Project owner</span>
            <AdminNav current="usage" role={role} />
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Usage</h1>
          <p className="text-sm text-neutral-500">
            What each plan allows, how much is used, and how long is left at the
            current rate. The database is measured from inside; meters the
            vendors keep to themselves link to their dashboards.
          </p>
        </div>

        {pendingMigration ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            A database migration is pending: <code>{pendingMigration}</code>. Paste{" "}
            <code>supabase/pending-migrations.generated.sql</code> into the Supabase SQL editor and
            run it; the measured figures appear once it is in.
          </p>
        ) : null}

        {/* What you are on */}
        <section className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Hosting"
            value={`${hosting.provider === "vercel" ? "Vercel" : "Netlify"} ${hosting.plan}`}
            sub={hosting.priceUsd ? `$${hosting.priceUsd}/month` : "free"}
          />
          <Stat
            label="Database"
            value={`Supabase ${sb.plan}`}
            sub={sb.priceUsd ? `$${sb.priceUsd}/month · backups ${sb.backups}` : `free · backups: ${sb.backups}`}
          />
          <Stat
            label="Fixed cost"
            value={`$${monthlyUsd}/month`}
            sub={`≈ ₹${(monthlyUsd * 85).toLocaleString("en-IN")}/month`}
          />
        </section>
        {config.assumed.length ? (
          <p className="text-xs text-neutral-500">
            Not set in the environment, so assumed: {config.assumed.join(", ")}. Set{" "}
            <code>HOSTING_PROVIDER</code>, <code>HOSTING_PLAN</code> and <code>SUPABASE_PLAN</code>{" "}
            when you upgrade so the limits follow.
          </p>
        ) : null}

        {!hosting.commercialUse && takingMoney ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            Restaurants are paying, and the {hosting.provider === "vercel" ? "Vercel Hobby" : hosting.plan}{" "}
            plan does not allow commercial use. Upgrade hosting before the next payment.
          </p>
        ) : null}

        {/* Database */}
        <Card title="Database" dashboard={sb.dashboard}>
          <Meter
            label={sb.database.label}
            used={usage?.db_bytes ?? null}
            limit={sb.database.limit}
            usedText={formatBytes(usage?.db_bytes)}
            limitText={formatBytes(sb.database.limit)}
            note={
              usage
                ? growthPerMonth && growthPerMonth > 0
                  ? `growing ≈ ${formatBytes(growthPerMonth)}/month from ${formatCount(usage.counts.orders_30d)} orders in 30 days${
                      dbMonthsLeft != null ? ` · full in about ${dbMonthsLeft} months` : ""
                    }`
                  : "no order growth in the last 30 days"
                : null
            }
            dashboard={sb.dashboard}
          />
          <Meter
            label={sb.storage.label}
            used={usage?.storage_bytes ?? null}
            limit={sb.storage.limit}
            usedText={formatBytes(usage?.storage_bytes)}
            limitText={formatBytes(sb.storage.limit)}
            note={
              usage?.storage_objects != null
                ? `${formatCount(usage.storage_objects)} files${
                    usage.storage_objects ? ` · ≈ ${formatBytes((usage.storage_bytes ?? 0) / usage.storage_objects)} each` : ""
                  }`
                : null
            }
            dashboard={sb.dashboard}
          />
          <Meter
            label={sb.egress.label}
            used={null}
            limit={sb.egress.limit}
            usedText="—"
            limitText={formatBytes(sb.egress.limit)}
            note={sb.egress.note}
            dashboard={sb.dashboard}
          />
          <Meter
            label={sb.realtimeConnections.label}
            used={null}
            limit={sb.realtimeConnections.limit}
            usedText="—"
            limitText={formatCount(sb.realtimeConnections.limit)}
            note="waiter and kitchen screens plus guests watching an order; peaks at dinner"
            dashboard={sb.dashboard}
          />
          <Meter
            label={sb.realtimeMessages.label}
            used={null}
            limit={sb.realtimeMessages.limit}
            usedText="—"
            limitText={formatCount(sb.realtimeMessages.limit)}
            dashboard={sb.dashboard}
          />
          {usage ? (
            <details className="text-xs text-neutral-500">
              <summary className="cursor-pointer">Biggest tables</summary>
              <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                {usage.tables.map((t) => (
                  <li key={t.name} className="flex justify-between tabular-nums">
                    <span className="font-mono">{t.name}</span>
                    <span>{formatBytes(t.bytes)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>

        {/* Hosting */}
        <Card
          title={`Hosting — ${hosting.provider === "vercel" ? "Vercel" : "Netlify"} ${hosting.plan}`}
          dashboard={hosting.dashboard}
        >
          {hosting.credits ? (
            <Meter
              label={hosting.credits.label}
              used={null}
              limit={hosting.credits.limit}
              usedText="—"
              limitText={formatCount(hosting.credits.limit)}
              note={hosting.credits.note}
              dashboard={hosting.dashboard}
            />
          ) : null}
          <Meter
            label={hosting.bandwidth.label}
            used={null}
            limit={hosting.bandwidth.limit}
            usedText="—"
            limitText={hosting.bandwidth.limit == null ? "—" : formatBytes(hosting.bandwidth.limit)}
            note={hosting.bandwidth.note}
            dashboard={hosting.dashboard}
          />
          <Meter
            label={hosting.functions.label}
            used={null}
            limit={hosting.functions.limit}
            usedText="—"
            limitText={hosting.functions.limit == null ? "—" : formatCount(hosting.functions.limit)}
            note={hosting.functions.note}
            dashboard={hosting.dashboard}
          />
          <Meter
            label={hosting.images.label}
            used={null}
            limit={hosting.images.limit}
            usedText="—"
            limitText={hosting.images.limit == null ? "—" : formatCount(hosting.images.limit)}
            note={hosting.images.note}
            dashboard={hosting.dashboard}
          />
          {usage ? (
            <p className="text-xs text-neutral-500">
              Load right now: {formatCount(usage.counts.live)} live{" "}
              {usage.counts.live === 1 ? "menu" : "menus"} ({formatCount(usage.counts.pro)} on Pro),{" "}
              {formatCount(usage.counts.dishes)} dishes with {formatCount(usage.counts.images)} photos,{" "}
              {formatCount(usage.counts.orders_month)} orders this month. Bandwidth is not measurable
              from the app; the dashboard has it.
            </p>
          ) : null}
        </Card>

        {/* CI and errors */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="CI — GitHub Actions" dashboard="https://github.com/settings/billing">
            <GithubMeter result={github} />
          </Card>
          <Card title="Errors — Sentry" dashboard="https://sentry.io/settings/billing/overview/">
            <Meter
              label="Errors / month"
              used={null}
              limit={SENTRY_FREE_ERRORS}
              usedText="—"
              limitText={formatCount(SENTRY_FREE_ERRORS)}
              note="beyond the free allowance, errors are dropped, not billed"
              dashboard="https://sentry.io/settings/billing/overview/"
            />
          </Card>
        </div>

        {/* Money */}
        {usage ? (
          <Card title="This month">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Fact label="Paid to you" value={rupees(usage.payments_month_paise)} />
              <Fact
                label="Razorpay fee (est.)"
                value={rupees(Math.round(usage.payments_month_paise * RAZORPAY_FEE_RATE))}
              />
              <Fact label="Infrastructure" value={`≈ ₹${(monthlyUsd * 85).toLocaleString("en-IN")}`} />
              <Fact
                label="Restaurants"
                value={`${formatCount(usage.counts.restaurants)} · ${formatCount(usage.counts.published)} published`}
              />
            </dl>
          </Card>
        ) : null}

        {/* When to upgrade */}
        <Card title="When to upgrade">
          <ul className="space-y-1 text-sm">
            <Trigger
              tone={!hosting.commercialUse ? (takingMoney ? "danger" : "warn") : "ok"}
              text={
                hosting.commercialUse
                  ? "Hosting allows commercial use."
                  : "Hosting: upgrade to a paid plan the day the first restaurant pays — the free plan forbids commercial use."
              }
            />
            <Trigger
              tone={sb.plan === "free" ? (takingMoney ? "danger" : "warn") : "ok"}
              text={
                sb.plan === "pro"
                  ? "Supabase Pro: daily backups are on."
                  : "Supabase: upgrade before the first Pro restaurant goes live — the free plan has no backups."
              }
            />
            <Trigger
              tone={toneFor(dbPct)}
              text={
                dbPct == null
                  ? "Database: measured once the migration is applied."
                  : dbMonthsLeft != null && dbMonthsLeft < 3
                    ? `Database: ${dbPct}% used and full in about ${dbMonthsLeft} months — upgrade now.`
                    : `Database: ${dbPct}% used${dbMonthsLeft != null ? `, about ${dbMonthsLeft} months left` : ""}.`
              }
            />
            <Trigger
              tone={toneFor(storagePct)}
              text={
                storagePct == null
                  ? "Image storage: not measurable on this install."
                  : `Image storage: ${storagePct}% used.`
              }
            />
            {hosting.credits ? (
              <Trigger
                tone="warn"
                text="Netlify credits: every production deploy costs 15 of 300. Batch merges, and check the meter around the 15th."
              />
            ) : null}
          </ul>
        </Card>

        {usage ? (
          <p className="text-xs text-neutral-400">
            Measured {new Date(usage.generated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.
            Plan limits are typed from the vendors&apos; pricing pages (October 2026); when one looks
            wrong, the page is.
          </p>
        ) : null}
      </div>
    </main>
  );
}

function GithubMeter({
  result,
}: {
  result: { ok: true; data: GithubActionsUsage | null } | { ok: false; error: string };
}) {
  if (!result.ok) {
    return (
      <p className="text-xs text-red-700 dark:text-red-300">Could not read GitHub: {result.error}</p>
    );
  }
  const u = result.data;
  if (!u) {
    return (
      <Meter
        label="Minutes / month"
        used={null}
        limit={GITHUB_ACTIONS_FREE_MINUTES}
        usedText="—"
        limitText={formatCount(GITHUB_ACTIONS_FREE_MINUTES)}
        note="set GITHUB_USAGE_TOKEN and GITHUB_BILLING_OWNER to read this live"
        dashboard="https://github.com/settings/billing"
      />
    );
  }
  return (
    <Meter
      label="Minutes / month"
      used={u.usedMinutes}
      limit={u.includedMinutes || GITHUB_ACTIONS_FREE_MINUTES}
      usedText={formatCount(u.usedMinutes)}
      limitText={formatCount(u.includedMinutes || GITHUB_ACTIONS_FREE_MINUTES)}
      note={u.paidMinutes ? `${formatCount(u.paidMinutes)} paid minutes` : "a CI run is about 5 minutes"}
    />
  );
}

function Card({
  title,
  dashboard,
  children,
}: {
  title: string;
  dashboard?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {dashboard ? (
          <a
            href={dashboard}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-neutral-500 underline"
          >
            Dashboard <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-lg font-semibold capitalize">{value}</p>
      {sub ? <p className="text-xs text-neutral-500">{sub}</p> : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Trigger({ tone, text }: { tone: "ok" | "warn" | "danger" | "unknown"; text: string }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          tone === "ok" && "bg-green-500",
          tone === "warn" && "bg-amber-500",
          tone === "danger" && "bg-red-500",
          tone === "unknown" && "bg-neutral-300",
        )}
        aria-hidden
      />
      <span>{text}</span>
    </li>
  );
}
