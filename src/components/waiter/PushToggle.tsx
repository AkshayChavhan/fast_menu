"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";

import { removePushSubscription, savePushSubscription } from "@/app/waiter/push-actions";
import { cn } from "@/lib/utils";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

// Returns a Uint8Array over a plain ArrayBuffer, which is what
// pushManager.subscribe() accepts as applicationServerKey.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "unsupported" | "checking" | "off" | "on" | "blocked" | "busy";

const noop = () => () => {};

// Bell in the waiter header. Subscribes this phone to pushes for new orders
// and guest requests; a second tap unsubscribes. Hidden entirely when the
// app has no VAPID keys, since nothing would ever be sent.
export function PushToggle() {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    (async () => {
      if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("blocked");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!cancelled) setState(sub ? "on" : "off");
    })().catch(() => {
      if (!cancelled) setState("unsupported");
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  async function turnOn() {
    setState("busy");
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const json = sub.toJSON();
      const res = await savePushSubscription({
        endpoint: json.endpoint,
        keys: json.keys,
        userAgent: navigator.userAgent.slice(0, 300),
      });
      if (!res.ok) {
        await sub.unsubscribe();
        setError(res.error);
        setState("off");
        return;
      }
      setState("on");
    } catch {
      setError("Couldn't turn notifications on.");
      setState("off");
    }
  }

  async function turnOff() {
    setState("busy");
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Couldn't turn notifications off.");
      setState("on");
    }
  }

  if (state === "unsupported" || state === "checking") return null;

  const on = state === "on";
  return (
    <div className="relative">
      <button
        type="button"
        onClick={on ? turnOff : turnOn}
        disabled={state === "busy" || state === "blocked"}
        aria-pressed={on}
        aria-label={
          state === "blocked"
            ? "Notifications are blocked in your browser settings"
            : on
              ? "Turn off notifications"
              : "Turn on notifications for new orders"
        }
        title={
          state === "blocked"
            ? "Notifications are blocked in your browser settings"
            : on
              ? "Notifications on"
              : "Get a buzz for new orders and guest requests"
        }
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors disabled:opacity-50",
          on
            ? "border-brand-200 bg-brand-50 text-brand-600 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-300"
            : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800",
        )}
      >
        {state === "busy" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : state === "blocked" ? (
          <BellOff className="h-4 w-4" aria-hidden />
        ) : on ? (
          <BellRing className="h-4 w-4" aria-hidden />
        ) : (
          <Bell className="h-4 w-4" aria-hidden />
        )}
      </button>
      {error ? (
        <p role="alert" className="absolute right-0 top-11 w-48 rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-700 shadow dark:bg-red-950/60 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
