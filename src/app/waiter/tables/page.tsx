import { requireContext } from "@/lib/membership";
import { loadTableBoard } from "@/app/waiter/data";
import { TableBoard } from "@/components/waiter/TableBoard";

export const dynamic = "force-dynamic";

export default async function TablesBoardPage() {
  const { restaurant } = await requireContext("orders:serve");
  const tables = await loadTableBoard(restaurant.id);

  const taken = tables.filter((t) => t.session).length;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold">Tables</h1>
        <p className="text-sm text-neutral-500">
          {taken} of {tables.length} taken. Tap a free table to seat guests.
        </p>
      </div>
      <TableBoard
        restaurantId={restaurant.id}
        tables={tables}
        currency={restaurant.currency}
        locale={restaurant.default_locale}
      />
    </div>
  );
}
