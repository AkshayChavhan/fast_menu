"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setPending(false);
      return;
    }

    // Only follow same-origin relative "next" targets to avoid open redirects.
    const nextParam = searchParams.get("next");
    const next =
      nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
        ? nextParam
        : "/dashboard";

    router.push(next);
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Sign in to manage your menu.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-sm font-medium text-neutral-700"
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
            className="block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="you@restaurant.com"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1.5 block text-sm font-medium text-neutral-700"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
            className="block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p
            id="login-error"
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="font-semibold text-brand-600 hover:text-brand-700"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
