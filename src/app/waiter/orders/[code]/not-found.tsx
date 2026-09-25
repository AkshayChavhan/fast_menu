import Link from "next/link";
import { SearchX } from "lucide-react";

export default function OrderNotFound() {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 px-6 py-14 text-center dark:border-neutral-700">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-800">
        <SearchX className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="text-base font-semibold">No order with that code</h1>
      <p className="mx-auto mt-1 max-w-xs text-sm text-neutral-500">
        Check the code on the guest&apos;s screen. Unapproved orders expire after two hours.
      </p>
      <Link
        href="/waiter/scan"
        className="mt-5 inline-block rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
      >
        Scan again
      </Link>
    </div>
  );
}
