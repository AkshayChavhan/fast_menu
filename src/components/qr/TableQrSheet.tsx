"use client";

import { useCallback } from "react";
import Link from "next/link";
import { LayoutGrid, Printer } from "lucide-react";

import { tableMenuPath } from "@/lib/paths";
import type { RestaurantTable } from "@/types/db";

// One printable card per table. Each QR encodes /m/<slug>?t=<token>, so the
// table is filled in for the waiter when the guest orders. Uses the /api/qr
// route like the review card: these codes never change once printed.
export function TableQrSheet({
  origin,
  slug,
  restaurantName,
  tables,
}: {
  origin: string;
  slug: string;
  restaurantName: string;
  tables: RestaurantTable[];
}) {
  const print = useCallback(() => {
    // The menu QR studio on this page hides everything but its own layout
    // when printing; flag the document so the rules below win instead.
    const root = document.documentElement;
    root.classList.add("print-tables");
    const done = () => {
      root.classList.remove("print-tables");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  }, []);

  return (
    <section className="mt-10 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900 print:border-0 print:p-0">
      <style>{`
        @media print {
          html.print-tables .qr-print-area,
          html.print-tables .qr-print-area * {
            visibility: hidden !important;
          }
          html.print-tables .table-print-area,
          html.print-tables .table-print-area * {
            visibility: visible !important;
          }
          html.print-tables .table-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
          }
          .table-card {
            break-inside: avoid;
          }
        }
      `}</style>

      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <div className="flex items-center gap-2 text-brand-600">
            <LayoutGrid className="h-4 w-4" aria-hidden />
            <h2 className="text-xs font-semibold uppercase tracking-wide">Table codes</h2>
          </div>
          <p className="mt-2 max-w-xl text-sm text-neutral-500">
            One card per table. Guests who scan it order with the table already
            filled in for the waiter. Rename tables under{" "}
            <Link href="/dashboard/tables" className="font-medium text-brand-600 hover:underline">
              Tables
            </Link>{" "}
            any time; the codes keep working.
          </p>
        </div>
        <button
          type="button"
          onClick={print}
          disabled={tables.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          <Printer className="h-4 w-4" aria-hidden /> Print table cards
        </button>
      </div>

      {tables.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No active tables yet.{" "}
          <Link href="/dashboard/tables" className="font-medium text-brand-600 hover:underline">
            Add your tables
          </Link>{" "}
          to print their codes.
        </p>
      ) : (
        <div className="table-print-area mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-6">
          {tables.map((table) => {
            const url = `${origin}${tableMenuPath(slug, table.qr_token)}`;
            const qrSrc = `/api/qr?url=${encodeURIComponent(url)}&size=384`;
            return (
              <div
                key={table.id}
                className="table-card flex flex-col items-center gap-2 rounded-2xl border-2 border-brand-500 bg-white p-4 text-center"
              >
                <p className="text-2xl font-extrabold leading-none text-neutral-900">
                  {table.label}
                </p>
                <div className="h-28 w-28 rounded bg-white p-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- our own route */}
                  <img
                    src={qrSrc}
                    alt={`QR code for ${table.label} at ${restaurantName}`}
                    width={112}
                    height={112}
                    className="h-full w-full object-contain"
                  />
                </div>
                <p className="text-sm font-bold leading-tight text-neutral-900">
                  Scan to see the menu &amp; order
                </p>
                <p className="max-w-full truncate text-[10px] font-medium uppercase tracking-wide text-brand-600">
                  {restaurantName}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
