import * as Sentry from "@sentry/nextjs";

// Browser-side error monitoring, loaded before the app becomes interactive.
// Off entirely without a DSN.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // The browser only sees NEXT_PUBLIC_* vars, and Netlify has no public
    // equivalent of VERCEL_ENV — set NEXT_PUBLIC_DEPLOY_ENV there instead.
    environment:
      process.env.NEXT_PUBLIC_VERCEL_ENV ??
      process.env.NEXT_PUBLIC_DEPLOY_ENV ??
      process.env.NODE_ENV,
    tracesSampleRate: 0.05,
    // Guests type nothing sensitive, but staff phones show order notes;
    // keep replays off.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const onRouterTransitionStart = dsn
  ? Sentry.captureRouterTransitionStart
  : () => {};
