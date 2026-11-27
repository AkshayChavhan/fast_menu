import { requireCapability } from "../lib";
import { getSiteOrigin } from "@/lib/site";
import { SettingsForm } from "@/components/dashboard/settings/SettingsForm";
import { OrderingSettingsCard } from "@/components/dashboard/settings/OrderingSettingsCard";
import { IntegrationsCard } from "@/components/dashboard/settings/IntegrationsCard";
import {
  BillingSettingsCard,
  type TaxCategory,
} from "@/components/dashboard/settings/BillingSettingsCard";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const { restaurant } = await requireCapability("settings:manage");
  const origin = await getSiteOrigin();

  // The Bill & taxes card needs migrations/*_billing_tax.sql. On a database
  // without it the columns are simply absent; say so rather than offer a
  // form whose save would fail.
  const taxReady = "tax_mode" in restaurant;
  let categories: TaxCategory[] = [];
  if (taxReady) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("categories")
      .select("id, name, tax_class")
      .eq("restaurant_id", restaurant.id)
      .order("sort_order", { ascending: true });
    categories = (data as TaxCategory[] | null) ?? [];
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-neutral-500">
          Configure how your restaurant and public menu appear.
        </p>
      </div>
      <SettingsForm restaurant={restaurant} origin={origin} />
      <OrderingSettingsCard restaurant={restaurant} />
      {taxReady ? (
        <BillingSettingsCard restaurant={restaurant} categories={categories} />
      ) : (
        <section className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <h2 className="font-semibold">Bill &amp; taxes</h2>
          <p className="mt-1">
            Almost ready: the database update for tax settings hasn&apos;t been applied
            yet (migration 20260924004300_billing_tax.sql).
          </p>
        </section>
      )}
      <IntegrationsCard restaurant={restaurant} />
    </div>
  );
}
