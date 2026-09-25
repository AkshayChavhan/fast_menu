import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireContext } from "@/lib/membership";
import { loadSession } from "@/app/waiter/data";
import { SessionDetail } from "@/components/waiter/SessionDetail";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { restaurant } = await requireContext("orders:serve");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const session = await loadSession(restaurant.id, id);
  if (!session) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/waiter/tables"
        className="inline-flex items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Tables
      </Link>
      <SessionDetail
        restaurantId={restaurant.id}
        session={session}
        currency={restaurant.currency}
        locale={restaurant.default_locale}
      />
    </div>
  );
}
