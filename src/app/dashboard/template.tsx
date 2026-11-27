import type { ReactNode } from "react";
import { ViewTransition } from "react";

// A template, unlike the layout, mounts afresh on every page change, so its
// enter and exit fire when the owner moves between dashboard pages: the old
// page fades out fast and the new one fades up (globals.css). It does not
// remount on router.refresh(), so saving a form never makes the page blink.
//
// Browsers without the View Transitions API just swap the page as before.
export default function DashboardTemplate({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="dash-in" exit="dash-out" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
