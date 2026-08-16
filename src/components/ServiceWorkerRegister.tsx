"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker once, after the page has loaded.
 * Renders nothing. Registration is skipped in development so the SW cache
 * never interferes with hot reloads.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Silent: a failed SW registration must never break the page.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
