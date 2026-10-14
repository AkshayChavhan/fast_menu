import type { Metadata } from "next";
import Link from "next/link";
import { IndianRupee } from "lucide-react";

import { requireProjectOwner } from "@/app/admin/lib";
import { AdminNav } from "@/components/admin/AdminNav";
import { PLAN_LABELS, type Plan } from "@/lib/plans";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Payments — fast_menu",
  robots: { index: false, follow: false },
};

interface PaymentRow {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_slug: string;
  provider: string;
  provider_order_id: string;
  provider_payment_id: string | null;
  plan: Plan;
  months: number;
  amount_paise: number;
  status: "created" | "paid" | "failed";
  created_at: string;
  paid_at: string | null;
}

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const STATUS_TONE: Record<PaymentRow["status"], string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  created: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

// Project-owner page: what restaurants paid us. The only money in the
// operator pages, and it is ours — a restaurant's own takings never appear.
export default async function PaymentsPage() {
  const { supabase, role } = await requireProjectOwner("/admin/payments");

  const { data, error } = await supabase.rpc("list_payments", { p_limit: 500 });
  if (error) throw new Error(`Failed to load payments: ${error.message}`);
  const rows = (data as PaymentRow[] | null) ?? [];

  const paid = rows.filter((r) => r.status === "paid");
  const total = paid.reduce((sum, r) => sum + r.amount_paise, 0);
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const last30 = paid
    .filter((r) => r.paid_at && new Date(r.paid_at) >= since)
    .reduce((sum, r) => sum + r.amount_paise, 0);

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <div className="flex items-center gap-2 text-brand-600">
            <IndianRupee className="h-5 w-5" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wide">Project owner</span>
            <AdminNav current="payments" role={role} />
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Payments</h1>
          <p className="text-sm text-neutral-500">
            Every Razorpay order restaurants started, newest first. A
            &ldquo;created&rdquo; row is a checkout that never finished.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Paid, all time" value={rupees(total)} />
          <Stat label="Paid, last 30 days" value={rupees(last30)} />
          <Stat label="Paid orders" value={String(paid.length)} />
          <Stat
            label="Unfinished checkouts"
            value={String(rows.filter((r) => r.status === "created").length)}
          />
        </dl>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-500 dark:border-neutral-700">
            No payments yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Restaurant</th>
                  <th className="px-3 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Paid</th>
                  <th className="px-3 py-2 font-medium">Razorpay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white dark:divide-neutral-800 dark:bg-neutral-950">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/restaurants/${r.restaurant_id}`}
                        className="font-medium hover:underline"
                      >
                        {r.restaurant_name}
                      </Link>
                      <div className="text-xs text-neutral-500">/m/{r.restaurant_slug}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {PLAN_LABELS[r.plan]} · {r.months} mo
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                      {rupees(r.amount_paise)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                          STATUS_TONE[r.status],
                        )}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-neutral-600 dark:text-neutral-300">
                      {when(r.paid_at ?? (r.status === "paid" ? r.created_at : null))}
                      {r.status !== "paid" ? (
                        <div className="text-xs text-neutral-400">started {when(r.created_at)}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-neutral-500">
                      {r.provider_payment_id ?? r.provider_order_id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
