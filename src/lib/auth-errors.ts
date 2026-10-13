// Supabase auth errors carry a machine `code` on current versions and only a
// `message` on older ones, so each check accepts either.
type AuthErrorLike = { message: string; code?: string; status?: number };

export function isEmailRateLimit(error: AuthErrorLike): boolean {
  return (
    error.code === "over_email_send_rate_limit" ||
    /email rate limit/i.test(error.message)
  );
}

export function isEmailNotConfirmed(error: AuthErrorLike): boolean {
  return (
    error.code === "email_not_confirmed" ||
    /email not confirmed/i.test(error.message)
  );
}

// The text a person sees for a failed sign-up, resend or sign-in. Anything we
// don't recognise passes through unchanged — Supabase's own wording for a weak
// password or a malformed address is already clear.
export function friendlyAuthError(error: AuthErrorLike): string {
  if (isEmailRateLimit(error)) {
    return "Too many emails have been sent recently. Please wait a while and try again.";
  }
  if (isEmailNotConfirmed(error)) {
    return "Your email isn't confirmed yet. Open the link we sent you, or request a new one below.";
  }
  if (error.code === "over_request_rate_limit" || error.status === 429) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  return error.message;
}
