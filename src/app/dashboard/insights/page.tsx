import Link from "next/link";
import { BarChart3, Sparkles } from "lucide-react";

import { requireCapability } from "../lib";
import { can } from "@/lib/permissions";
import { effectivePlan, planAllows } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { buildInsightsView, parseInsights, type InsightsFormat } from "@/lib/insights";
import { formatPrice } from "@/lib/utils";
import { ColumnChart } from "@/components/dashboard/insights/ColumnChart";
import { RankedBars, SplitBar, StatTiles } from "@/components/dashboard/insights/Figures";

export const metadata = {
  title: "Insights — fast_menu",
};

// Always the latest numbers: the first tile is today's takings.
export const dynamic = "force-dynamic";

// How this restaurant writes money and counts. Built here, on the server, and
// used to write every label once (see lib/insights.ts).
function formatFor(currency: string, locale: string): InsightsFormat {
  const number = (n: number) => {
    try {
      return new Intl.NumberFormat(locale).format(n);
    } catch {
      return String(n);
    }
  };
  return {
    money: (cents) => formatPrice(cents, currency, locale),
    compactMoney: (cents) => {
      try {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          notation: "compact",
          // Currency style asks for two decimals; an axis wants "₹10K", not "₹10.00K".
          minimumFractionDigits: 0,
          maximumFractionDigits: 1,
        }).format(cents / 100);
      } catch {
        return formatPrice(cents, currency, locale);
      }
    },
    number,
  };
}

function Card({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    // min-w-0: a card is a grid item, and without it one unwrappable row
    // inside widens the whole column past a phone screen.
    <section className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note ? <p className="mt-0.5 text-xs text-neutral-500">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Heading({ subtitle }: { subtitle: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Insights</h1>
      <p className="text-sm text-neutral-500">{subtitle}</p>
    </div>
  );
}

export default async function InsightsPage() {
  const { restaurant, role } = await requireCapability("reports:view");

  // Everything here is read off orders and bills, which only Pro produces.
  if (!planAllows(effectivePlan(restaurant), "ordering")) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Heading subtitle="Sales, busy hours and best sellers, from your own orders." />
        <div className="rounded-2xl border border-dashed border-neutral-300 px-6 py-12 text-center dark:border-neutral-700">
          <Sparkles className="mx-auto h-6 w-6 text-brand-600" aria-hidden />
          <p className="mt-3 text-sm font-semibold">Insights come with table ordering</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-neutral-500">
            Once guests order from the table and bills are settled here, this
            page shows your sales day by day, your busiest hours and what sells.
          </p>
          <Link
            href="/dashboard/upgrade"
            className="mt-5 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            See the Pro plan
          </Link>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("restaurant_insights", { rid: restaurant.id });
  if (error) throw new Error(`Failed to load insights: ${error.message}`);
  const insights = parseInsights(data);
  if (!insights) throw new Error("Failed to load insights: unexpected response");

  const view = buildInsightsView(
    insights,
    formatFor(restaurant.currency, restaurant.default_locale),
  );

  if (!view.hasActivity) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Heading subtitle="Sales, busy hours and best sellers, from your own orders." />
        <div className="rounded-2xl border border-dashed border-neutral-300 px-6 py-12 text-center dark:border-neutral-700">
          <BarChart3 className="mx-auto h-6 w-6 text-neutral-400" aria-hidden />
          <p className="mt-3 text-sm font-semibold">Nothing to show yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-neutral-500">
            {restaurant.ordering_enabled
              ? "This page fills in as soon as the first order is approved and the first bill is marked paid."
              : "Ordering is switched off, so there are no orders to count."}
          </p>
          {!restaurant.ordering_enabled && can(role, "settings:manage") ? (
            <Link
              href="/dashboard/settings"
              className="mt-5 inline-flex rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Open Settings
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Heading
        subtitle={`${view.todayLabel}, and the 30 days up to it, by the clock in ${insights.timezone}.`}
      />

      <StatTiles tiles={view.tiles} />

      <Card title="Sales by day" note={view.monthSummary}>
        <ColumnChart
          data={view.daily}
          label="Sales by day, last 30 days"
          columns={["Day", "Sales", "Bills and orders"]}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Busiest hours"
          note={
            view.peakHour
              ? `Most orders come in ${view.peakHour}. Orders placed, last 30 days.`
              : "Orders placed, last 30 days."
          }
        >
          <ColumnChart
            data={view.hours}
            label="Orders by hour of the day, last 30 days"
            columns={["Hour", "Orders"]}
          />
        </Card>

        <Card
          title="Busiest days"
          note={
            view.peakWeekday
              ? `${view.peakWeekday} is your busiest day. Orders placed, last 4 weeks.`
              : "Orders placed, last 4 weeks."
          }
        >
          <ColumnChart
            data={view.weekdays}
            label="Orders by day of the week, last 4 weeks"
            columns={["Day", "Orders", "Sales"]}
          />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Best sellers" note="Plates sold and what they brought in, last 30 days.">
          <RankedBars rows={view.topDishes} empty="No dishes sold in the last 30 days." />
        </Card>

        <div className="min-w-0 space-y-6">
          <Card
            title="Not ordered in 30 days"
            note="On your menu the whole time, available now, and not ordered once."
          >
            {view.unsold.count === 0 ? (
              <p className="text-sm text-neutral-500">Every dish on the menu sold at least once.</p>
            ) : (
              <>
                <ul className="flex flex-wrap gap-1.5">
                  {view.unsold.names.map((name) => (
                    <li
                      key={name}
                      className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                    >
                      {name}
                    </li>
                  ))}
                </ul>
                {view.unsold.more > 0 ? (
                  <p className="mt-2 text-xs text-neutral-500">and {view.unsold.more} more</p>
                ) : null}
              </>
            )}
          </Card>

          <Card title="Popular add-ons" note="Plates that carried each add-on, last 30 days.">
            <RankedBars rows={view.addons} empty="No add-ons ordered in the last 30 days." />
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Who places the orders" note="Last 30 days.">
          <SplitBar parts={view.source} label="Orders by who placed them" />
        </Card>
        <Card title="Dine in or parcel" note="Last 30 days.">
          <SplitBar parts={view.service} label="Orders by dine in or parcel" />
        </Card>
      </div>
    </div>
  );
}
