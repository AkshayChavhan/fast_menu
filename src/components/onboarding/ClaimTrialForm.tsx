"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Loader2, ShieldAlert, Smartphone } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { claimTrial, type ClaimResult } from "@/app/onboarding/claim/actions";
import { CLAIM_MESSAGES } from "@/lib/trial-messages";
import type { TrialStatus } from "@/types/db";

type Step = "details" | "otp";

const COUNTRY_CODES = [
  { code: "+91", label: "🇮🇳 +91" },
  { code: "+971", label: "🇦🇪 +971" },
  { code: "+1", label: "🇺🇸 +1" },
  { code: "+44", label: "🇬🇧 +44" },
  { code: "+61", label: "🇦🇺 +61" },
  { code: "+65", label: "🇸🇬 +65" },
];

// Splits a stored E.164-ish number ("919876543210") back into the country
// code list above plus the local part, so a returning owner sees their number.
function splitPhone(stored: string | null): { code: string; local: string } {
  if (!stored) return { code: "+91", local: "" };
  const digits = stored.replace(/\D/g, "");
  for (const { code } of COUNTRY_CODES) {
    const cc = code.slice(1);
    if (digits.startsWith(cc) && digits.length > cc.length) {
      return { code, local: digits.slice(cc.length) };
    }
  }
  return { code: "+91", local: digits };
}

export function ClaimTrialForm({
  restaurantId,
  restaurantName,
  initialStatus,
  initial,
  mode,
}: {
  restaurantId: string;
  restaurantName: string;
  initialStatus: TrialStatus;
  initial: {
    phone: string | null;
    city: string | null;
    pincode: string | null;
    gstin: string | null;
  };
  // 'phone' verifies the number with an SMS code; 'none' trusts it as typed
  // (until an SMS provider is configured) but still runs the duplicate checks.
  mode: "phone" | "none";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const split = splitPhone(initial.phone);
  const [countryCode, setCountryCode] = useState(split.code);
  const [local, setLocal] = useState(split.local);
  const [city, setCity] = useState(initial.city ?? "");
  const [pincode, setPincode] = useState(initial.pincode ?? "");
  const [gstin, setGstin] = useState(initial.gstin ?? "");
  const [code, setCode] = useState("");

  const [step, setStep] = useState<Step>("details");
  const [result, setResult] = useState<ClaimResult | null>(
    initialStatus === "needs_review" || initialStatus === "denied"
      ? { status: initialStatus, reason: initialStatus === "denied" ? "already_denied" : "similar_name" }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const e164 = `${countryCode}${local.replace(/\D/g, "")}`;

  function validateDetails(): string | null {
    if (local.replace(/\D/g, "").length < 6) return "Enter your mobile number.";
    if (pincode && !/^\d{4,10}$/.test(pincode.replace(/\s/g, ""))) return "Enter a valid pincode.";
    return null;
  }

  async function sendCode(): Promise<boolean> {
    setSending(true);
    setError(null);
    const supabase = createClient();
    // Attaching the phone to the account sends the SMS; verifying the code
    // below marks it confirmed, which claim_trial() then checks.
    const { error: sendError } = await supabase.auth.updateUser({ phone: e164 });
    setSending(false);
    if (sendError) {
      setError(sendError.message);
      return false;
    }
    return true;
  }

  function submitClaim() {
    startTransition(async () => {
      const res = await claimTrial({
        restaurantId,
        phone: e164,
        gstin: gstin.trim() || null,
        city: city.trim() || null,
        pincode: pincode.replace(/\s/g, "") || null,
      });
      if (res.status === "error") {
        setError(CLAIM_MESSAGES[res.reason ?? ""] ?? res.reason ?? "Something went wrong");
        return;
      }
      setResult(res);
      if (res.status === "active") {
        router.push("/dashboard");
        router.refresh();
      }
    });
  }

  async function onDetails(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = validateDetails();
    if (problem) {
      setError(problem);
      return;
    }
    if (mode === "none") {
      submitClaim();
      return;
    }
    if (await sendCode()) setStep("otp");
  }

  async function onOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: e164,
      token: code.trim(),
      type: "phone_change",
    });
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    submitClaim();
  }

  // ---- Terminal states -----------------------------------------------------

  if (result?.status === "denied") {
    return (
      <Card
        icon={<ShieldAlert className="h-6 w-6" aria-hidden />}
        tone="red"
        title="This hotel already has an account"
      >
        <p>{CLAIM_MESSAGES[result.reason ?? ""] ?? CLAIM_MESSAGES.already_denied}</p>
        <p className="mt-3">
          If you work at that hotel, ask its owner to add you as a manager or
          staff member from their dashboard instead of creating a new account.
          If you think this is a mistake, contact support and we&apos;ll sort it
          out.
        </p>
      </Card>
    );
  }

  if (result?.status === "needs_review") {
    return (
      <Card
        icon={<Clock className="h-6 w-6" aria-hidden />}
        tone="amber"
        title="We're checking your hotel"
      >
        <p>{CLAIM_MESSAGES.similar_name}</p>
        <p className="mt-3">
          You can build your menu in the meantime; publishing switches on as
          soon as the check is done, usually within a day.
        </p>
        <button
          type="button"
          onClick={() => {
            router.push("/dashboard");
            router.refresh();
          }}
          className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Go to the dashboard
        </button>
      </Card>
    );
  }

  if (result?.status === "active") {
    return (
      <Card
        icon={<CheckCircle2 className="h-6 w-6" aria-hidden />}
        tone="green"
        title="Your 15-day trial has started"
      >
        <p>Taking you to the dashboard…</p>
      </Card>
    );
  }

  // ---- OTP step -----------------------------------------------------------

  if (step === "otp") {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Smartphone className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">
            Enter the code we sent
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            An SMS is on its way to <span className="font-medium text-neutral-700">{e164}</span>.
          </p>
        </div>

        <form onSubmit={onOtp} className="space-y-4" noValidate>
          <div>
            <label htmlFor="otp" className="mb-1.5 block text-sm font-medium text-neutral-700">
              6-digit code
            </label>
            <input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={8}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={inputClass + " text-center text-lg tracking-[0.4em]"}
            />
          </div>

          {error ? <ErrorText>{error}</ErrorText> : null}

          <button
            type="submit"
            disabled={pending || code.trim().length < 4}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Verify and start my trial
          </button>

          <div className="flex items-center justify-between text-xs text-neutral-500">
            <button
              type="button"
              onClick={() => {
                setStep("details");
                setError(null);
              }}
              className="font-medium underline-offset-2 hover:underline"
            >
              Change number
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() => void sendCode()}
              className="font-medium underline-offset-2 hover:underline disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send again"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ---- Details step -------------------------------------------------------

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-bold tracking-tight text-neutral-900">
          Activate your free 15-day trial
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          One trial per hotel. Tell us which hotel{" "}
          <span className="font-medium text-neutral-700">{restaurantName}</span> is.
        </p>
      </div>

      <form onSubmit={onDetails} className="space-y-4" noValidate>
        <div>
          <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-neutral-700">
            Mobile number
          </label>
          <div className="flex gap-2">
            <select
              aria-label="Country code"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className="w-28 shrink-0 rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm"
            >
              {COUNTRY_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              required
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              className={inputClass}
              placeholder="98765 43210"
            />
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">
            {mode === "phone"
              ? "We'll text a code to confirm it's yours."
              : "The hotel's main contact number."}
          </p>
        </div>

        <div className="grid grid-cols-[1fr_120px] gap-3">
          <div>
            <label htmlFor="city" className="mb-1.5 block text-sm font-medium text-neutral-700">
              City
            </label>
            <input
              id="city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={80}
              autoComplete="address-level2"
              className={inputClass}
              placeholder="Pune"
            />
          </div>
          <div>
            <label htmlFor="pincode" className="mb-1.5 block text-sm font-medium text-neutral-700">
              Pincode
            </label>
            <input
              id="pincode"
              inputMode="numeric"
              value={pincode}
              onChange={(e) => setPincode(e.target.value)}
              maxLength={10}
              autoComplete="postal-code"
              className={inputClass}
              placeholder="411001"
            />
          </div>
        </div>

        <div>
          <label htmlFor="gstin" className="mb-1.5 block text-sm font-medium text-neutral-700">
            GSTIN <span className="font-normal text-neutral-400">(optional)</span>
          </label>
          <input
            id="gstin"
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
            maxLength={15}
            autoComplete="off"
            className={inputClass + " font-mono uppercase"}
            placeholder="27AAPFU0939F1ZV"
          />
        </div>

        {error ? <ErrorText>{error}</ErrorText> : null}

        <button
          type="submit"
          disabled={pending || sending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending || sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {mode === "phone" ? "Send me the code" : "Start my trial"}
        </button>
      </form>
    </div>
  );
}

const inputClass =
  "block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {children}
    </p>
  );
}

function Card({
  icon,
  tone,
  title,
  children,
}: {
  icon: React.ReactNode;
  tone: "red" | "amber" | "green";
  title: string;
  children: React.ReactNode;
}) {
  const tones = {
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-600",
    green: "bg-green-50 text-green-600",
  } as const;
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm sm:p-8">
      <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ${tones[tone]}`}>
        {icon}
      </div>
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">{title}</h1>
      <div className="mt-3 text-left text-sm text-neutral-600">{children}</div>
    </div>
  );
}
