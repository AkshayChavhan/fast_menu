import * as Sentry from "@sentry/nextjs";

// Attach who-and-where to server errors without any personal data: the
// user id (never the email), the restaurant and the role. Safe to call
// when Sentry is not configured; it just sets scope on a disabled client.
export function tagRequest(tags: { userId: string; restaurantId: string; role: string }): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  try {
    Sentry.setUser({ id: tags.userId });
    Sentry.setTag("restaurant", tags.restaurantId);
    Sentry.setTag("role", tags.role);
  } catch {
    /* monitoring must never break a request */
  }
}

// Report a failure that the request itself swallows — a webhook we have
// acknowledged, say — so it reaches a human instead of only a log line.
// Always also logs: a payment problem must be visible without Sentry.
export function captureError(
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  console.error("[fast_menu]", error, context);
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  try {
    Sentry.captureException(error, { extra: context });
  } catch {
    /* monitoring must never break a request */
  }
}

