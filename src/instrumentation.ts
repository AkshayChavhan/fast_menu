import * as Sentry from "@sentry/nextjs";

// Server-side error monitoring. Everything here is a no-op unless
// NEXT_PUBLIC_SENTRY_DSN is set, so local development and preview deploys
// without a Sentry project run exactly as before.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export async function register() {
  if (!dsn) return;
  Sentry.init({
    dsn,
    // Vercel and Netlify name these differently; without both, moving host
    // silently costs you "which deploy broke this".
    environment:
      process.env.VERCEL_ENV ?? process.env.CONTEXT ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_REF,
    // Errors matter; a small trace sample keeps the free tier comfortable.
    // Personal data is never attached: the SDK default is off, and
    // lib/monitoring.ts only sets ids and roles.
    tracesSampleRate: 0.05,
  });
}

// Next.js hands every captured server error here (Server Components,
// Server Functions, Route Handlers).
export const onRequestError = dsn
  ? Sentry.captureRequestError
  : async () => {};
