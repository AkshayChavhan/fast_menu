"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { Globe, Check, ChevronDown } from "lucide-react";
import { SUPPORTED_LOCALES } from "@/lib/constants";
import { cn } from "@/lib/utils";

const LOCALE_LABEL = new Map<string, string>(
  SUPPORTED_LOCALES.map((l) => [l.code, l.label]),
);

// Small dropdown that swaps the ?lang= param (preserving other params) so the
// server re-renders the menu in the chosen locale. Only rendered by the page
// when the restaurant offers more than one locale.
export function LanguageSwitcher({
  locales,
  active,
}: Readonly<{
  locales: string[];
  active: string;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function select(locale: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", locale);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white/80 px-3 py-1.5 text-sm font-semibold text-neutral-700 shadow-sm backdrop-blur transition hover:border-brand-300 hover:text-brand-600 dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-neutral-200 dark:hover:border-brand-700"
      >
        <Globe className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">
          {LOCALE_LABEL.get(active) ?? active.toUpperCase()}
        </span>
        <span className="sm:hidden">{active.toUpperCase()}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-50 mt-2 max-h-72 w-44 overflow-auto rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-xl shadow-black/10 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {locales.map((code) => {
            const isActive = code === active;
            return (
              <li key={code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => select(code)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition",
                    isActive
                      ? "bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300"
                      : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800",
                  )}
                >
                  <span>{LOCALE_LABEL.get(code) ?? code.toUpperCase()}</span>
                  {isActive && <Check className="h-4 w-4" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
