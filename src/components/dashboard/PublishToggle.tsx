"use client";

import { useState, useTransition } from "react";
import { Globe, Loader2 } from "lucide-react";
import { Switch } from "./Switch";
import { setPublished } from "@/app/dashboard/settings/actions";

// Optimistic publish/unpublish switch. Rolls back if the server action fails.
export function PublishToggle({
  restaurantId,
  initial,
}: {
  restaurantId: string;
  initial: boolean;
}) {
  const [published, setPublishedState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setError(null);
    setPublishedState(next); // optimistic
    startTransition(async () => {
      const res = await setPublished(restaurantId, next);
      if (!res.ok) {
        setPublishedState(!next); // rollback
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex items-start gap-3">
      <div
        className={
          "mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg " +
          (published
            ? "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300"
            : "bg-neutral-100 text-neutral-400 dark:bg-neutral-800")
        }
      >
        <Globe className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            {published ? "Menu is live" : "Menu is a draft"}
          </span>
          {isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />
          )}
        </div>
        <p className="text-xs text-neutral-500">
          {published
            ? "Guests can scan the QR code and view your menu."
            : "Only you can see it. Publish when you're ready."}
        </p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <Switch
        checked={published}
        onChange={toggle}
        disabled={isPending}
        tone="green"
        label="Toggle menu published"
      />
    </div>
  );
}
