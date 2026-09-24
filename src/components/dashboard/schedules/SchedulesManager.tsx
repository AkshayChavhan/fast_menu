"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import {
  createSchedule,
  deleteSchedule,
  setScheduleActive,
  updateSchedule,
} from "@/app/dashboard/schedules/actions";
import { describeDays } from "@/lib/schedule";
import type { Category, MenuSchedule } from "@/types/db";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/dashboard/Modal";
import { Switch } from "@/components/dashboard/Switch";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Mon-first for the picker; values stay 0 = Sunday to match the database.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

type Draft = {
  name: string;
  days: number[];
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

const hhmm = (t: string) => t.slice(0, 5);

function blankDraft(): Draft {
  return { name: "", days: [0, 1, 2, 3, 4, 5, 6], startsAt: "07:00", endsAt: "11:00", isActive: true };
}

function draftFrom(s: MenuSchedule): Draft {
  return {
    name: s.name,
    days: s.days,
    startsAt: hhmm(s.starts_at),
    endsAt: hhmm(s.ends_at),
    isActive: s.is_active,
  };
}

export function SchedulesManager({
  restaurantId,
  schedules,
  categories,
}: {
  restaurantId: string;
  schedules: MenuSchedule[];
  categories: Pick<Category, "id" | "name" | "schedule_id">[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MenuSchedule | "new" | null>(null);

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else router.refresh();
    });
  }

  const usedBy = (id: string) => categories.filter((c) => c.schedule_id === id).map((c) => c.name);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">
          {schedules.length === 0
            ? "No schedules yet."
            : `${schedules.length} ${schedules.length === 1 ? "schedule" : "schedules"}`}
        </p>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add schedule
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {schedules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-14 text-center dark:border-neutral-700">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-950/50">
            <Clock className="h-6 w-6" aria-hidden />
          </div>
          <h2 className="text-sm font-semibold">No schedules yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-500">
            Add Breakfast, Lunch or Happy hour, then pick it on a category
            under Menu. Categories without a schedule show all day.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {schedules.map((s) => {
            const busy = busyId === s.id && pending;
            const users = usedBy(s.id);
            return (
              <li
                key={s.id}
                className={cn(
                  "rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900",
                  !s.is_active && "opacity-70",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{s.name}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {describeDays(s.days)} · {hhmm(s.starts_at)}–{hhmm(s.ends_at)}
                      {hhmm(s.ends_at) < hhmm(s.starts_at) ? " (overnight)" : ""}
                    </p>
                    <p className="mt-1 text-[11px] text-neutral-400">
                      {users.length === 0 ? "Not used by any category yet" : `Used by ${users.join(", ")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin text-neutral-400" aria-hidden /> : null}
                    <Switch
                      size="sm"
                      tone="green"
                      checked={s.is_active}
                      disabled={busy}
                      onChange={(next) =>
                        run(s.id, () => setScheduleActive({ restaurantId, scheduleId: s.id, isActive: next }))
                      }
                      label={`${s.is_active ? "Pause" : "Resume"} ${s.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      disabled={busy}
                      aria-label={`Edit ${s.name}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(`Delete "${s.name}"? Its categories will show all day.`)) return;
                        run(s.id, () => deleteSchedule({ restaurantId, scheduleId: s.id }));
                      }}
                      disabled={busy}
                      aria-label={`Delete ${s.name}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <ScheduleModal
          key={editing === "new" ? "new" : editing.id}
          restaurantId={restaurantId}
          schedule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800";

function ScheduleModal({
  restaurantId,
  schedule,
  onClose,
}: {
  restaurantId: string;
  schedule: MenuSchedule | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => (schedule ? draftFrom(schedule) : blankDraft()));
  const [error, setError] = useState<string | null>(null);

  const overnight = draft.endsAt < draft.startsAt;

  function toggleDay(d: number) {
    setDraft((prev) => ({
      ...prev,
      days: prev.days.includes(d) ? prev.days.filter((x) => x !== d) : [...prev.days, d],
    }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = schedule
        ? await updateSchedule({ restaurantId, scheduleId: schedule.id, ...draft })
        : await createSchedule({ restaurantId, ...draft });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={schedule ? "Edit schedule" : "Add schedule"}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="schedule-form"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {schedule ? "Save" : "Add"}
          </button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="schedule-name" className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Name
          </label>
          <input
            id="schedule-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            required
            maxLength={60}
            placeholder="Breakfast"
            className={inputClass}
            autoFocus
          />
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">Days</p>
          <div className="flex flex-wrap gap-1.5">
            {DAY_ORDER.map((d) => {
              const on = draft.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    on
                      ? "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-900/30 dark:text-brand-300"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300",
                  )}
                >
                  {DAY_LABELS[d]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="schedule-start" className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              From
            </label>
            <input
              id="schedule-start"
              type="time"
              value={draft.startsAt}
              onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
              required
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="schedule-end" className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              Until
            </label>
            <input
              id="schedule-end"
              type="time"
              value={draft.endsAt}
              onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
              required
              className={inputClass}
            />
          </div>
        </div>
        <p className="text-[11px] text-neutral-400">
          {overnight
            ? "Ends after midnight: this window runs into the next morning and counts as the day it starts."
            : "Times are in the restaurant's timezone (Settings). An end before the start makes an overnight window."}
        </p>

        <label className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2.5 dark:border-neutral-700">
          <span className="text-sm font-medium">Active</span>
          <Switch
            size="sm"
            tone="green"
            checked={draft.isActive}
            onChange={(next) => setDraft({ ...draft, isActive: next })}
            label="Schedule active"
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
