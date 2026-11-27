"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, currentTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

// The server can't know the guest's theme; render the light-mode button and
// let the client correct it on hydration.
const serverTheme = (): Theme => "light";

// A round sun/moon button. Shows the theme you'd switch *to*: a moon on a
// light page, a sun on a dark one. Styled like the language switcher so the
// two sit together, and solid enough to read over the welcome video.
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => applyTheme(next)}
      aria-label={next === "dark" ? "Switch to dark mode" : "Switch to light mode"}
      title={next === "dark" ? "Dark mode" : "Light mode"}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white/80 text-neutral-700 shadow-sm backdrop-blur transition hover:border-brand-300 hover:text-brand-600 dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-neutral-200 dark:hover:border-brand-700",
        className,
      )}
    >
      {next === "dark" ? (
        <Moon className="h-4 w-4" aria-hidden />
      ) : (
        <Sun className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
