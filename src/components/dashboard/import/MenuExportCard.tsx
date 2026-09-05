"use client";

import { Download, FileJson } from "lucide-react";

import { downloadJson, datedFilename } from "@/lib/download-file";

// Download the live menu as the same JSON the importer accepts. Two jobs: a
// backup before a destructive import, and a filled-in starting point that beats
// editing the generic sample.
export function MenuExportCard({
  slug,
  menuJson,
  counts,
}: {
  slug: string;
  menuJson: string;
  counts: { categories: number; dishes: number };
}) {
  const isEmpty = counts.categories === 0 && counts.dishes === 0;
  const sizeKb = Math.max(1, Math.round(new Blob([menuJson]).size / 1024));

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <FileJson className="h-4 w-4 text-brand-500" aria-hidden />
            Export current menu
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            {isEmpty
              ? "Your menu is empty, so there's nothing to export yet."
              : `${counts.categories} categor${
                  counts.categories === 1 ? "y" : "ies"
                } and ${counts.dishes} dish${
                  counts.dishes === 1 ? "" : "es"
                } · about ${sizeKb} KB.`}
          </p>
        </div>

        <button
          type="button"
          disabled={isEmpty}
          onClick={() => downloadJson(datedFilename(slug), menuJson)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> Download JSON
        </button>
      </div>

      {!isEmpty ? (
        <p className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
          This is the same format the importer reads, so you can edit it and
          upload it straight back. Keep a copy before importing — an import
          replaces everything.
        </p>
      ) : null}
    </section>
  );
}
