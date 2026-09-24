"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import type { Restaurant } from "@/types/db";
import { Switch } from "@/components/dashboard/Switch";
import { updateOrderingSettings } from "@/app/dashboard/settings/actions";
import type { ActionResult } from "@/app/dashboard/lib";

// Zones most of our restaurants live in, pinned to the top of the list.
const COMMON_TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "UTC",
];

type Switches = Pick<
  Restaurant,
  "ordering_enabled" | "allow_takeaway" | "table_qr_enabled" | "kds_enabled"
>;

export function OrderingSettingsCard({ restaurant }: { restaurant: Restaurant }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    updateOrderingSettings,
    null,
  );

  const [switches, setSwitches] = useState<Switches>({
    ordering_enabled: restaurant.ordering_enabled,
    allow_takeaway: restaurant.allow_takeaway,
    table_qr_enabled: restaurant.table_qr_enabled,
    kds_enabled: restaurant.kds_enabled,
  });
  const [timezone, setTimezone] = useState(restaurant.timezone);

  // The browser knows where the owner is; offer it when nothing better is set.
  const detected = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }, []);

  const zones = useMemo(() => {
    let all: string[] = [];
    try {
      all = Intl.supportedValuesOf("timeZone");
    } catch {
      all = [];
    }
    const rest = all.filter((z) => !COMMON_TIMEZONES.includes(z));
    return [...COMMON_TIMEZONES, ...rest];
  }, []);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const set = (key: keyof Switches) => (next: boolean) =>
    setSwitches((prev) => ({ ...prev, [key]: next }));

  return (
    <form action={formAction}>
      <input type="hidden" name="restaurantId" value={restaurant.id} />
      {(Object.keys(switches) as (keyof Switches)[]).map((key) => (
        <input key={key} type="hidden" name={key} value={String(switches[key])} />
      ))}

      <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold">Table ordering</h2>
          <p className="text-xs text-neutral-500">
            Let guests order from the menu, waiters approve on their phones, and
            the counter settle bills.
          </p>
        </div>

        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          <SwitchRow
            title="Accept orders"
            body="Guests get Add buttons and a cart on your menu. Off means the menu is read-only, exactly as today."
            checked={switches.ordering_enabled}
            onChange={set("ordering_enabled")}
          />
          <SwitchRow
            title="Let guests choose parcel / takeaway"
            body="Adds a dine-in or parcel choice when placing an order. Waiters can always mark parcel themselves."
            checked={switches.allow_takeaway}
            onChange={set("allow_takeaway")}
            disabled={!switches.ordering_enabled}
          />
          <SwitchRow
            title="One QR code per table"
            body="Print a code for each table so the table number is filled in for the waiter. Manage tables under Tables."
            checked={switches.table_qr_enabled}
            onChange={set("table_qr_enabled")}
            disabled={!switches.ordering_enabled}
          />
          <SwitchRow
            title="Kitchen screen"
            body="Approved orders appear as tickets on a kitchen tablet. Give the kitchen its own login under Staff."
            checked={switches.kds_enabled}
            onChange={set("kds_enabled")}
            disabled={!switches.ordering_enabled}
          />

          <div className="px-5 py-4">
            <label
              htmlFor="timezone"
              className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300"
            >
              Timezone
            </label>
            <select
              id="timezone"
              name="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800"
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-neutral-400">
              Menu schedules, today&apos;s specials and day-end totals follow this clock.
              {detected && detected !== timezone ? (
                <>
                  {" "}
                  Your browser says{" "}
                  <button
                    type="button"
                    onClick={() => setTimezone(detected)}
                    className="font-medium text-brand-600 underline-offset-2 hover:underline"
                  >
                    {detected}
                  </button>
                  .
                </>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-neutral-100 px-5 py-3.5 dark:border-neutral-800">
          {state?.ok && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          {state && !state.ok && <span className="text-xs text-red-600">{state.error}</span>}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save ordering settings
          </button>
        </div>
      </section>
    </form>
  );
}

function SwitchRow({
  title,
  body,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  body: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={"flex items-start gap-4 px-5 py-4" + (disabled ? " opacity-60" : "")}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{body}</p>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} />
    </div>
  );
}
