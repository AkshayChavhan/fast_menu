import { cn } from "@/lib/utils";

interface WordmarkProps {
  /** Extra classes for the outer element. */
  className?: string;
  /** Size preset for the mark + text. Defaults to "md". */
  size?: "sm" | "md" | "lg";
  /** Render just the icon mark without the "fast_menu" wordmark text. */
  iconOnly?: boolean;
}

const SIZES = {
  sm: { box: "h-7 w-7 rounded-lg", icon: "h-4 w-4", text: "text-base" },
  md: { box: "h-9 w-9 rounded-xl", icon: "h-5 w-5", text: "text-lg" },
  lg: { box: "h-12 w-12 rounded-2xl", icon: "h-7 w-7", text: "text-2xl" },
} as const;

/**
 * The fast_menu logo mark. A rounded brand-orange tile holding a stylized
 * QR/menu glyph, followed by the "fast_menu" wordmark. Import anywhere a brand
 * lockup is needed (nav, footer, auth screens, print assets).
 */
export function Wordmark({
  className,
  size = "md",
  iconOnly = false,
}: WordmarkProps) {
  const s = SIZES[size];
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "grid place-items-center bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-sm shadow-brand-600/30 ring-1 ring-inset ring-white/10",
          s.box,
        )}
        aria-hidden="true"
      >
        {/* Minimal QR-code glyph — pure SVG, no external asset. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={s.icon}
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.35" />
          <rect x="5" y="5" width="3" height="3" rx="0.5" fill="currentColor" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.35" />
          <rect x="16" y="5" width="3" height="3" rx="0.5" fill="currentColor" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.35" />
          <rect x="5" y="16" width="3" height="3" rx="0.5" fill="currentColor" />
          <rect x="14" y="14" width="3" height="3" rx="0.5" fill="currentColor" />
          <rect x="18.5" y="14" width="2.5" height="2.5" rx="0.5" fill="currentColor" />
          <rect x="14" y="18.5" width="2.5" height="2.5" rx="0.5" fill="currentColor" />
          <rect x="18.5" y="18.5" width="2.5" height="2.5" rx="0.5" fill="currentColor" />
        </svg>
      </span>
      {!iconOnly && (
        <span
          className={cn(
            "font-bold tracking-tight text-neutral-900 dark:text-white",
            s.text,
          )}
        >
          fast<span className="text-brand-500">_</span>menu
        </span>
      )}
    </span>
  );
}

export default Wordmark;
