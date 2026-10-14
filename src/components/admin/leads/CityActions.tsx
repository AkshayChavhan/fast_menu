"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, FileJson, FileUp, Loader2, Plus } from "lucide-react";

import {
  createLead,
  fetchOsmLeads,
  importLeadsJson,
  type ImportMode,
  type ImportResult,
} from "@/app/admin/leads/actions";
import { claudePromptFor, importTemplate } from "@/lib/leads/import";
import { Modal } from "@/components/dashboard/Modal";
import type { LeadCity } from "@/lib/leads/types";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800";

// The two ways a restaurant gets onto the list for a city: pulled from
// OpenStreetMap, or typed in by whoever found it.
export function CityActions({
  city,
  leadCount,
  canReplace,
}: {
  city: LeadCity;
  // How many are on the list now: what "remove and replace" would delete.
  leadCount: number;
  // Only a project owner may wipe a city; the database enforces it too.
  canReplace: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  function fetchFromOsm() {
    setFetching(true);
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await fetchOsmLeads({ cityId: city.id });
      setFetching(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(
        res.found === 0
          ? `OpenStreetMap has no named restaurants mapped around ${city.name} yet. Add them by hand as you find them.`
          : `${res.found} found on OpenStreetMap, ${res.added} new.`,
      );
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={fetchFromOsm}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          {fetching ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Download className="h-4 w-4" aria-hidden />
          )}
          Fetch from OpenStreetMap
        </button>
        <button
          type="button"
          onClick={() => setImporting(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          <FileJson className="h-4 w-4" aria-hidden />
          Import JSON
        </button>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add restaurant
        </button>
      </div>
      {message ? <p className="text-sm text-neutral-600 dark:text-neutral-300">{message}</p> : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <AddLeadModal city={city} open={adding} onClose={() => setAdding(false)} />
      <ImportModal
        city={city}
        leadCount={leadCount}
        canReplace={canReplace}
        open={importing}
        onClose={() => setImporting(false)}
      />
    </div>
  );
}

function AddLeadModal({
  city,
  open,
  onClose,
}: {
  city: LeadCity;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setPhone("");
    setWebsite("");
    setAddress("");
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createLead({ cityId: city.id, name, phone, website, address });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reset();
      onClose();
      router.push(`/admin/leads/${res.id}`);
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Add a restaurant in ${city.name}`}>
      <form id="add-lead" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-neutral-500">
          Name
          <input
            className={`${inputClass} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            autoFocus
            placeholder="Hotel Sai Palace"
          />
        </label>
        <label className="block text-xs font-medium text-neutral-500">
          Phone
          <input
            className={`${inputClass} mt-1`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={32}
            inputMode="tel"
            placeholder="98765 43210"
          />
        </label>
        <label className="block text-xs font-medium text-neutral-500">
          Website, if they have one
          <input
            className={`${inputClass} mt-1`}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            maxLength={200}
            inputMode="url"
            placeholder="saipalace.in"
          />
        </label>
        <label className="block text-xs font-medium text-neutral-500">
          Address or landmark
          <input
            className={`${inputClass} mt-1`}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={300}
            placeholder="Opposite the bus stand, College Road"
          />
        </label>
        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Add
          </button>
        </div>
      </form>
    </Modal>
  );
}

// A file for this city: pasted or chosen, then imported. The prompt and
// template are here so the person who needs a file can make one without
// reading docs — and the prompt's rules (real places, NA over a guess, a
// link for every rating) are what keep the imported data honest.
function ImportModal({
  city,
  leadCount,
  canReplace,
  open,
  onClose,
}: {
  city: LeadCity;
  leadCount: number;
  canReplace: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<ImportMode>("update");
  const [confirmed, setConfirmed] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [copied, setCopied] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setResult(null);
    f.text().then(setText);
  }

  function copyPrompt() {
    navigator.clipboard.writeText(claudePromptFor(city.name, city.state)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadTemplate() {
    const blob = new Blob([importTemplate(city.name, city.state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${city.name.toLowerCase().replace(/\s+/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await importLeadsJson({ cityId: city.id, jsonText: text, mode });
      setResult(res);
      if (res.ok) {
        setText("");
        setFileName(null);
        setMode("update");
        setConfirmed(false);
      }
    });
  }

  function close() {
    setResult(null);
    setMode("update");
    setConfirmed(false);
    onClose();
  }

  // Replacing needs something to replace, the right to do it, and a tick.
  const replacing = mode === "replace";
  const canSubmit = text.trim().length >= 2 && (!replacing || confirmed);

  return (
    <Modal open={open} onClose={close} title={`Import restaurants into ${city.name}`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={copyPrompt}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-2.5 py-1.5 font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
            {copied ? "Copied" : "Copy prompt for Claude"}
          </button>
          <button
            type="button"
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-2.5 py-1.5 font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download template
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          Paste the prompt into Claude with web search on; it answers with a
          JSON file in the template&apos;s shape. &ldquo;NA&rdquo; means not known
          and stays that way: it is never read as &ldquo;no&rdquo;. A restaurant
          already on the list is updated, not duplicated, and nothing a caller
          typed is overwritten.
        </p>

        <label className="block text-xs font-medium text-neutral-500">
          <span className="inline-flex items-center gap-1.5">
            <FileUp className="h-3.5 w-3.5" aria-hidden />
            Choose a .json file
          </span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={onFile}
            className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium dark:file:border-neutral-700 dark:file:bg-neutral-800"
          />
        </label>
        <label className="block text-xs font-medium text-neutral-500">
          {fileName ? `${fileName} — or paste instead` : "Or paste the JSON here"}
          <textarea
            className={`${inputClass} mt-1 min-h-[8rem] font-mono text-xs`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
            spellCheck={false}
            placeholder={'{ "city": "' + city.name + '", "restaurants": [ ... ] }'}
          />
        </label>

        {leadCount > 0 ? (
          <fieldset className="space-y-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-700">
            <legend className="px-1 text-xs font-medium text-neutral-500">
              {leadCount} {leadCount === 1 ? "restaurant is" : "restaurants are"} already on this list
            </legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="import-mode"
                checked={!replacing}
                onChange={() => {
                  setMode("update");
                  setConfirmed(false);
                }}
                className="mt-1"
              />
              <span>
                <span className="font-medium">Update the list</span>
                <span className="block text-xs text-neutral-500">
                  Matches by phone or name, fills in blanks, keeps every call log.
                </span>
              </span>
            </label>
            <label className={cn("flex items-start gap-2", !canReplace && "opacity-50")}>
              <input
                type="radio"
                name="import-mode"
                checked={replacing}
                disabled={!canReplace}
                onChange={() => setMode("replace")}
                className="mt-1"
              />
              <span>
                <span className="font-medium">Remove the existing {leadCount} and replace</span>
                <span className="block text-xs text-neutral-500">
                  {canReplace
                    ? "Deletes them and their call logs, then imports the file as new. Cannot be undone."
                    : "Only a project owner can do this."}
                </span>
              </span>
            </label>
            {replacing ? (
              <label className="flex items-start gap-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:bg-red-900/30 dark:text-red-200">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I understand {leadCount} {leadCount === 1 ? "restaurant" : "restaurants"} in{" "}
                  {city.name}, with every note logged against them, will be deleted.
                </span>
              </label>
            ) : null}
          </fieldset>
        ) : null}

        {result && !result.ok ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {result.error}
          </p>
        ) : null}
        {result && result.ok ? (
          <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-200">
            <p>
              {result.removed ? `${result.removed} removed, ` : ""}
              {result.inserted} added, {result.updated} updated
              {result.skipped.length ? `, ${result.skipped.length} skipped` : ""}.
            </p>
            {result.warning ? <p className="mt-1 text-amber-800 dark:text-amber-200">{result.warning}</p> : null}
            {result.skipped.length ? (
              <ul className="mt-1 text-xs">
                {result.skipped.slice(0, 5).map((s) => (
                  <li key={s.index}>
                    Row {s.index + 1}: {s.reason}
                  </li>
                ))}
                {result.skipped.length > 5 ? <li>…and {result.skipped.length - 5} more</li> : null}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {result?.ok ? "Done" : "Cancel"}
          </button>
          <button
            type="submit"
            disabled={pending || !canSubmit}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60",
              replacing ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700",
            )}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {replacing ? "Remove and replace" : "Import"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
