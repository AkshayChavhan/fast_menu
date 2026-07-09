import { getActiveContext } from "../lib";
import { getSiteOrigin } from "@/lib/site";
import { SettingsForm } from "@/components/dashboard/settings/SettingsForm";

export default async function SettingsPage() {
  const { restaurant } = await getActiveContext();
  const origin = await getSiteOrigin();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-neutral-500">
          Configure how your restaurant and public menu appear.
        </p>
      </div>
      <SettingsForm restaurant={restaurant} origin={origin} />
    </div>
  );
}
