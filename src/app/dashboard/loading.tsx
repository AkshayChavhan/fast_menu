import { ViewTransition } from "react";

// Shown the moment a sidebar item is clicked, while the server renders the
// next page. Every dashboard page inherits it. Without it the old page sat
// frozen until the new one was ready, then snapped across.
//
// The shape is generic on purpose (a title, a line of help, a few cards):
// it only has to say "your page is on its way", not mimic each page.
export default function DashboardLoading() {
  return (
    // Fades out quickly when the real page arrives (globals.css).
    <ViewTransition exit="dash-out" default="none">
      <div
        role="status"
        aria-label="Loading"
        className="mx-auto max-w-5xl animate-pulse space-y-6"
      >
        <div className="space-y-2">
          <div className="h-7 w-48 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-4 w-80 max-w-full rounded bg-neutral-200/70 dark:bg-neutral-800/70" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-28 rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
            />
          ))}
        </div>
        <div className="h-64 rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
        <span className="sr-only">Loading…</span>
      </div>
    </ViewTransition>
  );
}
