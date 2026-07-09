import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";

// Minimal centered shell for the auth screens (login / signup).
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xl font-bold tracking-tight text-neutral-900"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white">
              <UtensilsCrossed className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              fast<span className="text-brand-600">_menu</span>
            </span>
          </Link>
        </div>
        {children}
      </div>
    </main>
  );
}
