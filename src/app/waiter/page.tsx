import { ClipboardList, PowerOff } from "lucide-react";
import { requireContext } from "@/lib/membership";

export default async function WaiterHomePage() {
  const { restaurant } = await requireContext("orders:serve");

  if (!restaurant.ordering_enabled) {
    return (
      <Notice
        icon={<PowerOff className="h-6 w-6" aria-hidden />}
        title="Table ordering is switched off"
        body="Once the owner turns it on in Settings, orders waiting for approval will show up here."
      />
    );
  }

  return (
    <Notice
      icon={<ClipboardList className="h-6 w-6" aria-hidden />}
      title="No orders waiting"
      body="Orders placed from the menu appear here as soon as guests send them."
    />
  );
}

function Notice({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 px-6 py-14 text-center dark:border-neutral-700">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-950/50">
        {icon}
      </div>
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="mx-auto mt-1 max-w-xs text-sm text-neutral-500">{body}</p>
    </div>
  );
}
