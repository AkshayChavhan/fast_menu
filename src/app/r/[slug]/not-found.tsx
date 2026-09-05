import Link from "next/link";
import { MessageSquareOff } from "lucide-react";

export default function ReviewNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-neutral-900">
          <MessageSquareOff className="h-8 w-8" aria-hidden />
        </div>
        <h1 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">
          This review page isn&apos;t available
        </h1>
        <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
          The link may be out of date, or the restaurant has turned off
          feedback for now.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm font-medium text-brand-600 hover:underline"
        >
          Go to fast_menu
        </Link>
      </div>
    </div>
  );
}
