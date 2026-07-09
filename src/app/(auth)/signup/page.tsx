"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // "form" while collecting input; "confirm" needs email verification;
  // "ready" when a session already exists (email confirmation disabled).
  const [status, setStatus] = useState<"form" | "confirm" | "ready">("form");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createClient();
    const emailRedirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/confirm`
        : undefined;

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setPending(false);
      return;
    }

    // If Supabase returned an active session, the project doesn't require
    // email confirmation — the user can go straight to the dashboard.
    setStatus(data.session ? "ready" : "confirm");
    setPending(false);
  }

  if (status !== "form") {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          {status === "confirm" ? (
            <MailCheck className="h-6 w-6" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          )}
        </div>

        {status === "confirm" ? (
          <>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Check your email
            </h1>
            <p className="mt-2 text-sm text-neutral-500">
              We sent a confirmation link to{" "}
              <span className="font-medium text-neutral-700">{email}</span>.
              Click it to activate your account, then sign in.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              Go to sign in
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              You&apos;re all set
            </h1>
            <p className="mt-2 text-sm text-neutral-500">
              Your account is ready. Head to your dashboard to build your first
              menu.
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              Go to dashboard
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Create your account
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Start building QR menus in minutes.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label
            htmlFor="full_name"
            className="mb-1.5 block text-sm font-medium text-neutral-700"
          >
            Full name
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={pending}
            className="block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Alex Rivera"
          />
        </div>

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
            aria-describedby={error ? "signup-error" : undefined}
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
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "signup-error" : "password-hint"}
            className="block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="At least 6 characters"
          />
          <p id="password-hint" className="mt-1.5 text-xs text-neutral-400">
            Use at least 6 characters.
          </p>
        </div>

        {error && (
          <p
            id="signup-error"
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
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-semibold text-brand-600 hover:text-brand-700"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
