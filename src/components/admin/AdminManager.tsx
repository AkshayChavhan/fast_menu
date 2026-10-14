"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

import { removePlatformAdmin, setPlatformAdmin } from "@/app/admin/admins/actions";
import { ADMIN_ROLES, ADMIN_ROLE_LABELS, type AdminRole } from "@/lib/admin-role";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface AdminRow {
  email: string;
  role: AdminRole;
  created_at: string;
}

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800";

// Who can open the operator pages, and at which level. The signed-in
// owner's own row has no remove button: the database would refuse it if
// they are the last owner, and if they are not, someone else should do it.
export function AdminManager({ rows, selfEmail }: { rows: AdminRow[]; selfEmail: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("admin");
  const [error, setError] = useState<string | null>(null);

  function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    setError(null);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong");
        return;
      }
      router.refresh();
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    const em = email;
    run("add", async () => {
      const res = await setPlatformAdmin({ email: em, role });
      if (res.ok) setEmail("");
      return res;
    });
  }

  function changeRole(row: AdminRow, next: AdminRole) {
    if (
      next === "project_owner" &&
      !window.confirm(
        `Make ${row.email} a project owner? They will be able to change plans, see payments and manage admins.`,
      )
    ) {
      return;
    }
    run(row.email, () => setPlatformAdmin({ email: row.email, role: next }));
  }

  function remove(row: AdminRow) {
    if (!window.confirm(`Remove ${row.email} from the operator pages?`)) return;
    run(row.email, () => removePlatformAdmin({ email: row.email }));
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        {rows.map((row) => {
          const isSelf = row.email.toLowerCase() === selfEmail.toLowerCase();
          const rowBusy = busy === row.email;
          return (
            <li key={row.email} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {row.email}
                  {isSelf ? <span className="ml-2 text-xs text-neutral-400">you</span> : null}
                </p>
                <p className="text-xs text-neutral-500">added {timeAgo(row.created_at)}</p>
              </div>
              <select
                className={cn(inputClass, "w-auto")}
                value={row.role}
                disabled={pending || isSelf}
                onChange={(e) => changeRole(row, e.target.value as AdminRole)}
                aria-label={`Role for ${row.email}`}
              >
                {ADMIN_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ADMIN_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              {isSelf ? null : (
                <button
                  type="button"
                  onClick={() => remove(row)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60 dark:text-red-300 dark:hover:bg-red-900/30"
                >
                  {rowBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <form
        onSubmit={add}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <label className="block min-w-[14rem] flex-1 text-xs font-medium text-neutral-500">
          Email
          <input
            type="email"
            className={`${inputClass} mt-1`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={200}
            placeholder="someone@example.com"
          />
        </label>
        <label className="block text-xs font-medium text-neutral-500">
          Level
          <select
            className={`${inputClass} mt-1`}
            value={role}
            onChange={(e) => setRole(e.target.value as AdminRole)}
          >
            {ADMIN_ROLES.map((r) => (
              <option key={r} value={r}>
                {ADMIN_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending || !email.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Add
        </button>
        <p className="w-full text-xs text-neutral-500">
          They sign in with this email like anyone else; the operator pages
          open for them once it is on this list. An admin sees who needs a
          call and can review trials and leads. A project owner can also set
          plans, see payments and change this list.
        </p>
      </form>
    </div>
  );
}
