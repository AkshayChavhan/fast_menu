"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

// Read-only URL field with a copy button.
export function CopyUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be unavailable (e.g. insecure context) — ignore.
    }
  }

  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
      <span className="min-w-0 flex-1 truncate bg-neutral-50 px-3 py-2 font-mono text-sm text-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-200">
        {url}
      </span>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "inline-flex items-center gap-1.5 border-l border-neutral-200 px-3 text-xs font-medium transition-colors dark:border-neutral-700",
          copied
            ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
            : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
        )}
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5" /> Copied
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" /> Copy
          </>
        )}
      </button>
    </div>
  );
}
