// Light / dark for the guest menu.
//
// With no choice made the page follows the device (prefers-color-scheme).
// A guest who taps the toggle gets their pick remembered on this device: it
// is stored in localStorage and applied as a "light" or "dark" class on
// <html>, which tailwind.config.ts and globals.css read.

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "fast_menu:theme";

// Runs in <head> before the first paint (app/layout.tsx), so a saved choice
// never flashes the other theme first. Kept tiny and dependency-free, and
// wrapped in try: storage can throw in private mode or with cookies blocked.
export const THEME_INIT_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  `if(t==="light"||t==="dark")document.documentElement.classList.add(t)}catch(e){}`;

/** The theme the page is showing right now: a saved choice, else the device. */
export function currentTheme(): Theme {
  const html = document.documentElement;
  if (html.classList.contains("dark")) return "dark";
  if (html.classList.contains("light")) return "light";
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Show `theme` now and remember it on this device. */
export function applyTheme(theme: Theme): void {
  const html = document.documentElement;
  html.classList.remove("light", "dark");
  html.classList.add(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not remembered, but still applied for this visit.
  }
}

/** Calls `onChange` when the shown theme may have changed. Returns an unsubscribe. */
export function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const media =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  media?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", onChange);
  };
}
