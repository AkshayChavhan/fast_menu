import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

export default function Offline() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-white px-6 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
      <div className="max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <Wordmark iconOnly size="lg" />
        </div>
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          <WifiOff className="h-6 w-6" />
        </div>
        <h1 className="mb-3 text-2xl font-bold sm:text-3xl">You&apos;re offline</h1>
        <p className="mb-8 text-base leading-relaxed text-neutral-600 dark:text-neutral-400">
          This page isn&apos;t available without a connection. Reconnect and
          try again — pages you&apos;ve already visited will still work
          offline.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white transition-opacity duration-200 hover:opacity-90"
        >
          Go to homepage
        </Link>
      </div>
    </div>
  );
}
