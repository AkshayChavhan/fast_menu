import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// GET /auth/confirm — Supabase email-confirmation callback.
// Accepts both link shapes Supabase can send: `?token_hash=…&type=…` (our
// email template; works on any device) and `?code=…` (the default template's
// PKCE link; only works in the browser that signed up). On success it sends
// the person to /auth/home, which picks the right app for their role.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  // Only follow same-origin relative redirects to prevent open redirects.
  const nextParam = searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/auth/home";

  if ((token_hash && type) || code) {
    const supabase = await createClient();
    const { error } =
      token_hash && type
        ? await supabase.auth.verifyOtp({ type, token_hash })
        : await supabase.auth.exchangeCodeForSession(code!);

    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  // Verification failed or params missing — send back to login with a flag.
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", "confirmation_failed");
  return NextResponse.redirect(loginUrl);
}
