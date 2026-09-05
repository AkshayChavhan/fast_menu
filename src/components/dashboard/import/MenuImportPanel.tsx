"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  Loader2,
  Upload,
} from "lucide-react";

import {
  previewImport,
  applyImport,
  type ImportPreview,
} from "@/app/dashboard/import/actions";
import { downloadJson } from "@/lib/download-file";
import { cn } from "@/lib/utils";

const cardCls =
  "rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";

const btnSecondary =
  "inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";

export function MenuImportPanel({
  restaurantId,
  slug,
  currency,
  sampleJson,
}: {
  restaurantId: string;
  slug: string;
  currency: string;
  sampleJson: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, startTransition] = useTransition();

  const [fileName, setFileName] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ categories: number; dishes: number } | null>(
    null,
  );

  function reset() {
    setFileName(null);
    setRawText(null);
    setPreview(null);
    setError(null);
    setDone(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(file: File) {
    setError(null);
    setPreview(null);
    setDone(null);
    setFileName(file.name);

    const text = await file.text();
    setRawText(text);

    startTransition(async () => {
      const res = await previewImport(restaurantId, text);
      if (res.ok) setPreview(res.preview);
      else setError(res.error);
    });
  }

  function confirmImport() {
    if (!rawText) return;
    setError(null);
    startTransition(async () => {
      const res = await applyImport(restaurantId, slug, rawText);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.imported);
      setPreview(null);
      setRawText(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Step 1 — get a file to edit */}
      <div className={cardCls}>
        <h2 className="text-sm font-semibold">1. Start from a file</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Prices are written in {currency}, in major units — <code>12.5</code>{" "}
          means 12.50.
        </p>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => downloadJson("fast-menu-sample.json", sampleJson)}
            className={btnSecondary}
          >
            <Download className="h-3.5 w-3.5" /> Download sample file
          </button>
        </div>

        <p className="mt-3 text-xs text-neutral-500">
          Already have a menu? Exporting it above gives you this same format
          filled in with your real data — usually easier to edit than the
          sample.
        </p>
      </div>

      {/* Step 2 — upload */}
      <div className={cardCls}>
        <h2 className="text-sm font-semibold">2. Upload your edited file</h2>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
        />

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="mt-4 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 px-6 py-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-brand-950/20"
        >
          {busy ? (
            <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
          ) : (
            <Upload className="h-6 w-6 text-neutral-400" />
          )}
          <span className="text-sm font-medium">
            {fileName ?? "Choose a JSON file"}
          </span>
          <span className="text-xs text-neutral-500">
            Nothing changes until you confirm on the next step.
          </span>
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      {done ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5 dark:border-green-900/50 dark:bg-green-950/30">
          <p className="flex items-center gap-2 text-sm font-semibold text-green-900 dark:text-green-200">
            <CheckCircle2 className="h-4 w-4" />
            Imported {done.categories} categor
            {done.categories === 1 ? "y" : "ies"} and {done.dishes} dish
            {done.dishes === 1 ? "" : "es"}.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-3 text-xs font-medium text-green-800 underline dark:text-green-300"
          >
            Import another file
          </button>
        </div>
      ) : null}

      {/* Step 3 — confirm */}
      {preview ? (
        <div
          className={cn(
            cardCls,
            "border-amber-300 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20",
          )}
        >
          <h2 className="text-sm font-semibold">3. Confirm the replacement</h2>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-white p-3 dark:bg-neutral-900">
              <dt className="text-xs text-neutral-500">This file adds</dt>
              <dd className="mt-0.5 font-semibold">
                {preview.counts.categories} categories · {preview.counts.dishes}{" "}
                dishes
              </dd>
            </div>
            <div className="rounded-lg bg-white p-3 dark:bg-neutral-900">
              <dt className="text-xs text-neutral-500">It will delete</dt>
              <dd className="mt-0.5 font-semibold text-red-600 dark:text-red-400">
                {preview.replacing.categories} categories ·{" "}
                {preview.replacing.dishes} dishes
              </dd>
            </div>
          </dl>

          <p className="mt-3 flex items-start gap-2 text-xs text-amber-900 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Your entire menu is replaced by this file. Any dish pairings
              (&ldquo;goes well with&rdquo;) are cleared too, since the dishes
              they link are recreated.
            </span>
          </p>

          {preview.warnings.length > 0 ? (
            <details className="mt-4 rounded-lg bg-white p-3 dark:bg-neutral-900">
              <summary className="cursor-pointer text-xs font-medium text-neutral-600 dark:text-neutral-300">
                {preview.warnings.length} thing
                {preview.warnings.length === 1 ? "" : "s"} were ignored
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-neutral-500">
                {preview.warnings.map((w, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span aria-hidden>·</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="mt-5 flex items-center gap-2">
            <button
              type="button"
              onClick={confirmImport}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Replace my menu
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className={btnSecondary}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Format reference */}
      <details className={cardCls}>
        <summary className="cursor-pointer text-sm font-semibold">
          <FileJson className="mr-1.5 inline h-4 w-4 align-text-bottom" />
          File format
        </summary>
        <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-neutral-950 p-4 text-xs leading-relaxed text-neutral-200">
          {sampleJson}
        </pre>
      </details>
    </div>
  );
}
