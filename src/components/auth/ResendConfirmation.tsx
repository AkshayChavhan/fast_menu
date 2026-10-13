"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

// Long enough that a double-tap or an impatient user can't burn through the
// project's hourly email allowance.
const COOLDOWN_SECONDS = 60;

// Lets someone whose confirmation email never arrived ask for another, instead
// of being stranded on a "check your email" screen.
export function ResendConfirmation({ email }: { email: string }) {
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    setPending(true);
    setMessage(null);

    const { error } = await createClient().auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });

    setPending(false);
    if (error) {
      setMessage({ ok: false, text: friendlyAuthError(error) });
      return;
    }
    setMessage({ ok: true, text: "We sent a new link. Check your spam folder too." });
    setCooldown(COOLDOWN_SECONDS);
  }

  const disabled = pending || cooldown > 0 || !email.trim();

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={resend}
        disabled={disabled}
        className="font-semibold text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-neutral-400"
      >
        {cooldown > 0
          ? `Resend email in ${cooldown}s`
          : pending
            ? "Sending…"
            : "Resend email"}
      </button>
      {message && (
        <p
          role="status"
          className={`mt-2 ${message.ok ? "text-neutral-500" : "text-red-700"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
