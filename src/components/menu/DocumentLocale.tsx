"use client";

import { useEffect } from "react";

// A menu renders in whichever of the restaurant's locales the guest picked, but
// only the root layout renders <html> — and it is shared with the marketing
// pages, so its `lang` is a hardcoded "en" that would be a lie here. This
// corrects the document element for the active locale, in both navigation
// modes, following the Next.js "preventing flash before hydration" guide:
//
//   - hard navigation (a QR scan, a refresh): the inline script runs
//     synchronously while the browser parses the HTML, so `dir` is already
//     right at the first paint and an RTL menu never flashes left-aligned.
//   - soft navigation (the LanguageSwitcher's router.replace): the script is
//     inert text/plain by then, and the effect applies the change instead.
//
// `lang` earns its keep beyond accessibility and font selection: Chrome on
// Android and Safari on iOS read it to decide whether to offer their built-in
// page translation. A hardcoded "en" on a Tamil menu suppresses that offer,
// which is the only thing a guest has when we carry no translation for their
// language.
export function DocumentLocale({
  locale,
  dir,
}: Readonly<{ locale: string; dir: "ltr" | "rtl" }>) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = { lang: root.lang, dir: root.dir };
    root.lang = locale;
    root.dir = dir;
    // Restore on unmount so navigating off the menu doesn't leave the rest of
    // the app mirrored.
    return () => {
      root.lang = previous.lang;
      root.dir = previous.dir;
    };
  }, [locale, dir]);

  return (
    <script
      // Real script on the server; once React is running on the client it
      // renders as text/plain so it can never execute a second time — and so
      // React doesn't warn about rendering a <script>.
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        // JSON.stringify escapes the values — locales reach us from ?lang= and
        // from the database, so neither is trusted inside a script tag.
        __html:
          `document.documentElement.lang=${JSON.stringify(locale)};` +
          `document.documentElement.dir=${JSON.stringify(dir)}`,
      }}
    />
  );
}
