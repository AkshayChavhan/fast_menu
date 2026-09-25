import { cn } from "@/lib/utils";

// "Ravi Kumar" → "RK", "ravi@example.com" → "R", nothing → "?".
export function initialsFor(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters =
    words.length === 1
      ? words[0].slice(0, 1)
      : words[0].slice(0, 1) + words[words.length - 1].slice(0, 1);
  return letters.toUpperCase();
}

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-20 w-20 text-xl",
} as const;

// A staff member's profile photo, or their initials until one is uploaded.
export function StaffAvatar({
  src,
  name,
  size = "md",
  className,
}: {
  src: string | null;
  name: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const label = name?.trim() || "Staff member";
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300",
        SIZES[size],
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initialsFor(name)
      )}
    </span>
  );
}
