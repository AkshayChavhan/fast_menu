import { redirect } from "next/navigation";

import { requireContext } from "@/lib/membership";
import { Scanner } from "@/components/waiter/Scanner";

export const dynamic = "force-dynamic";

// A guest's order QR encodes /waiter/scan?code=XXXXXX, so scanning it with the
// phone's own camera app lands here already signed in (or via login) and goes
// straight to the order.
export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  await requireContext("orders:serve");
  const { code } = await searchParams;
  if (code && /^[a-z0-9]{4,8}$/i.test(code)) {
    redirect(`/waiter/orders/${code.toUpperCase()}`);
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold">Scan the guest&apos;s code</h1>
        <p className="text-sm text-neutral-500">
          Point the camera at the QR on their phone.
        </p>
      </div>
      <Scanner />
    </div>
  );
}
