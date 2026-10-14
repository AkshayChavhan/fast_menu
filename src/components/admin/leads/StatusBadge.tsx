import { LEAD_STATUS_LABELS, type LeadStatus, type WebsiteStatus } from "@/lib/leads/types";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<LeadStatus, string> = {
  new: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  reached: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  interested: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  demo_booked: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  trial: "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200",
  won: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  not_interested: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

export function StatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_TONE[status],
        className,
      )}
    >
      {LEAD_STATUS_LABELS[status]}
    </span>
  );
}

// The website column. An OSM row with no tag is "not recorded", never "no
// website": nobody has checked. "None" is only what a caller confirmed.
export function WebsiteCell({
  website,
  status,
}: {
  website: string | null;
  status: WebsiteStatus;
}) {
  if (website) {
    const href = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    const label = website.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="truncate text-brand-700 underline decoration-brand-300 hover:decoration-brand-600 dark:text-brand-300"
        title={website}
      >
        {label}
      </a>
    );
  }
  if (status === "none") {
    return (
      <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">
        No website
      </span>
    );
  }
  return <span className="text-xs text-neutral-400">Not recorded</span>;
}
