"use client";

import { useState, type ComponentPropsWithoutRef } from "react";
import { Eye, EyeOff } from "lucide-react";

// Matches the other auth inputs, plus room on the right for the toggle so a
// long password never runs underneath the eye.
const INPUT_CLASS =
  "block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 pr-11 text-sm text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60";

// `type` is ours to control, and the styling is fixed so login and signup can't
// drift apart.
type PasswordInputProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "type" | "className"
>;

// A password field with a show/hide toggle. Typing a password blind on a phone
// keyboard is the main reason people fail a sign-in they'd otherwise pass.
export function PasswordInput({ disabled, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  const Icon = visible ? EyeOff : Eye;
  const label = visible ? "Hide password" : "Show password";

  return (
    <div className="relative">
      <input
        {...props}
        disabled={disabled}
        type={visible ? "text" : "password"}
        className={INPUT_CLASS}
      />
      <button
        type="button"
        // Never a submit button: it sits inside the form, and Enter on it must
        // not sign the user in.
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-neutral-400 transition hover:text-neutral-600 focus-visible:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
