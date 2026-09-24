"use client";

import { useEffect, useState, useTransition, type ComponentType } from "react";
import { Bell, Check, Loader2, Receipt } from "lucide-react";

import { getDeviceKey } from "@/lib/cart";
import { cn } from "@/lib/utils";
import { requestService } from "@/app/m/[slug]/service/actions";

type Kind = "call_waiter" | "request_bill";

// Two quiet buttons under the table chip. Each turns into a "done" state for
// a while so the guest knows it went through and doesn't tap five times.
export function ServiceButtons({ slug, tableToken }: { slug: string; tableToken: string }) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [done, setDone] = useState<Record<Kind, boolean>>({ call_waiter: false, request_bill: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!done.call_waiter && !done.request_bill) return;
    const t = setTimeout(() => setDone({ call_waiter: false, request_bill: false }), 60_000);
    return () => clearTimeout(t);
  }, [done]);

  function send(kind: Kind) {
    setBusy(kind);
    setError(null);
    startTransition(async () => {
      const res = await requestService({ slug, tableToken, kind, deviceKey: getDeviceKey() });
      setBusy(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone((d) => ({ ...d, [kind]: true }));
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ServiceButton
        icon={Bell}
        label="Call a waiter"
        doneLabel="Waiter on the way"
        busy={busy === "call_waiter"}
        done={done.call_waiter}
        disabled={pending}
        onClick={() => send("call_waiter")}
      />
      <ServiceButton
        icon={Receipt}
        label="Ask for the bill"
        doneLabel="Bill requested"
        busy={busy === "request_bill"}
        done={done.request_bill}
        disabled={pending}
        onClick={() => send("request_bill")}
      />
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}

function ServiceButton({
  icon: Icon,
  label,
  doneLabel,
  busy,
  done,
  disabled,
  onClick,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  doneLabel: string;
  busy: boolean;
  done: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || done}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
        done
          ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-300"
          : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200",
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : done ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Icon className="h-3.5 w-3.5" aria-hidden />
      )}
      {done ? doneLabel : label}
    </button>
  );
}
