"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, LayoutGrid, Loader2, Pencil, Plus, QrCode, Trash2, X } from "lucide-react";

import {
  createTables,
  deleteTable,
  renameTable,
  setTableActive,
} from "@/app/dashboard/tables/actions";
import { expandTableLabels } from "@/lib/tables";
import type { RestaurantTable } from "@/types/db";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/dashboard/Switch";

export function TablesManager({
  restaurantId,
  tables,
  tableQrEnabled,
}: {
  restaurantId: string;
  tables: RestaurantTable[];
  tableQrEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const preview = useMemo(() => expandTableLabels(draft), [draft]);

  function run(id: string | null, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else router.refresh();
    });
  }

  function add() {
    if (preview.length === 0) {
      setError("Type table names or a range like 1-20.");
      return;
    }
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await createTables({ restaurantId, labels: preview });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDraft("");
      setNotice(
        res.skipped
          ? `Added ${res.added}; ${res.skipped} already existed.`
          : `Added ${res.added} ${res.added === 1 ? "table" : "tables"}.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Add */}
      <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <label htmlFor="new-tables" className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
          Add tables
        </label>
        <div className="flex gap-2">
          <input
            id="new-tables"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder="1-20, Bar, Patio 1-4"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800"
          />
          <button
            type="button"
            onClick={add}
            disabled={pending || preview.length === 0}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending && busyId === null ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            Add
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-neutral-400">
          Ranges expand: <span className="font-mono">1-20</span> makes twenty tables,{" "}
          <span className="font-mono">Patio 1-4</span> makes four.
          {preview.length > 0 ? (
            <span className="ml-1 font-medium text-neutral-600 dark:text-neutral-300">
              Will add {preview.length}: {preview.slice(0, 6).join(", ")}
              {preview.length > 6 ? "…" : ""}
            </span>
          ) : null}
        </p>
      </section>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-300">
          {notice}
        </p>
      ) : null}

      {/* QR hint */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/60">
        <span className="inline-flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
          <QrCode className="h-4 w-4 text-brand-600" aria-hidden />
          {tableQrEnabled
            ? "Per-table QR codes are on. Print one card per table from the QR page."
            : "Per-table QR codes are off; guests scan the single menu code and waiters type the table."}
        </span>
        <Link
          href={tableQrEnabled ? "/dashboard/qr" : "/dashboard/settings"}
          className="text-xs font-medium text-brand-600 hover:underline"
        >
          {tableQrEnabled ? "Print table codes" : "Turn on in Settings"}
        </Link>
      </div>

      {/* List */}
      {tables.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-14 text-center dark:border-neutral-700">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-950/50">
            <LayoutGrid className="h-6 w-6" aria-hidden />
          </div>
          <h2 className="text-sm font-semibold">No tables yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-500">
            Add a range like <span className="font-mono">1-12</span> to create your floor in one go.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {tables.map((table) => (
            <TableRow
              key={table.id}
              table={table}
              busy={busyId === table.id && pending}
              onRename={(label) =>
                run(table.id, () => renameTable({ restaurantId, tableId: table.id, label }))
              }
              onToggle={(next) =>
                run(table.id, () => setTableActive({ restaurantId, tableId: table.id, isActive: next }))
              }
              onDelete={() => {
                if (!window.confirm(`Delete "${table.label}"? Its printed QR code will stop working.`)) return;
                run(table.id, () => deleteTable({ restaurantId, tableId: table.id }));
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TableRow({
  table,
  busy,
  onRename,
  onToggle,
  onDelete,
}: {
  table: RestaurantTable;
  busy: boolean;
  onRename: (label: string) => void;
  onToggle: (next: boolean) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(table.label);

  function save() {
    const trimmed = label.trim();
    if (!trimmed || trimmed === table.label) {
      setEditing(false);
      setLabel(table.label);
      return;
    }
    onRename(trimmed);
    setEditing(false);
  }

  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900",
        !table.is_active && "opacity-60",
      )}
    >
      {editing ? (
        <>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") {
                setEditing(false);
                setLabel(table.label);
              }
            }}
            autoFocus
            maxLength={40}
            className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm font-semibold outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800"
          />
          <button type="button" onClick={save} aria-label="Save name" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30">
            <Check className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setLabel(table.label);
            }}
            aria-label="Cancel"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{table.label}</span>
          {busy ? <Loader2 className="h-4 w-4 animate-spin text-neutral-400" aria-hidden /> : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={busy}
            aria-label={`Rename ${table.label}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          <Switch
            size="sm"
            tone="green"
            checked={table.is_active}
            disabled={busy}
            onChange={onToggle}
            label={`${table.is_active ? "Retire" : "Reactivate"} ${table.label}`}
          />
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            aria-label={`Delete ${table.label}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </>
      )}
    </li>
  );
}
