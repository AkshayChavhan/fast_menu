import { ChefHat, PowerOff } from "lucide-react";
import { requireContext } from "@/lib/membership";

export default async function KitchenPage() {
  const { restaurant } = await requireContext("kitchen:view");

  if (!restaurant.kds_enabled) {
    return (
      <Notice
        icon={<PowerOff className="h-8 w-8" aria-hidden />}
        title="The kitchen screen is switched off"
        body="A manager can turn it on in Settings. Until then, orders go straight from the waiter to billing."
      />
    );
  }

  return (
    <Notice
      icon={<ChefHat className="h-8 w-8" aria-hidden />}
      title="No tickets"
      body="Approved orders will appear here as tickets."
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
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-neutral-700 px-8 py-16 text-center">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-950/60 text-brand-400">
        {icon}
      </div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-base text-neutral-400">{body}</p>
    </div>
  );
}
