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
