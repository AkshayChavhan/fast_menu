"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PauseCircle, PlayCircle } from "lucide-react";

import { Switch } from "./Switch";
import { setOrderingPaused } from "@/app/dashboard/settings/actions";

// The "kitchen closed" switch. Lives on the overview so a manager can flip it
// in two taps during service; the message is what guests read on the menu.
export function PauseOrderingCard({
  restaurantId,
  initialPaused,
  initialMessage,
}: {
  restaurantId: string;
  initialPaused: boolean;
  initialMessage: string | null;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(initialPaused);
  const [message, setMessage] = useState(initialMessage ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(nextPaused: boolean) {
    setError(null);
    setPaused(nextPaused); // optimistic
    startTransition(async () => {
      const res = await setOrderingPaused({
        restaurantId,
        paused: nextPaused,
        message,
      });
      if (!res.ok) {
        setPaused(!nextPaused);
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start gap-3">
        <div
          className={
            "mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg " +
            (paused
              ? "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300"
              : "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300")
          }
        >
          {paused ? <PauseCircle className="h-5 w-5" /> : <PlayCircle className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">
              {paused ? "Ordering is paused" : "Taking orders"}
            </span>
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
          </div>
          <p className="text-xs text-neutral-500">
            {paused
              ? "Guests can browse the menu but not place orders."
              : "Pause when the kitchen closes or gets slammed. The menu stays live."}
          </p>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
        <Switch
          checked={!paused}
          onChange={(on) => save(!on)}
          disabled={isPending}
          tone="green"
          label="Toggle ordering paused"
        />
      </div>

      <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
        <label
          htmlFor="pause_message"
          className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300"
        >
          Message shown while paused
        </label>
        <div className="flex gap-2">
          <input
            id="pause_message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={200}
            placeholder="Kitchen closed — back at 7 pm"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800"
          />
          <button
            type="button"
            disabled={isPending || message === (initialMessage ?? "")}
            onClick={() => save(paused)}
            className="shrink-0 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Save
          </button>
        </div>
      </div>
    </section>
  );
}
