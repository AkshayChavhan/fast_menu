import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { OPTIMIZED_IMAGE_HOSTS } from "./src/lib/image-hosts";

const nextConfig: NextConfig = {
  images: {
    // One list, shared with the menu: see src/lib/image-hosts.ts.
    remotePatterns: OPTIMIZED_IMAGE_HOSTS.map((p) => ({ ...p })),
  },
};

// Sentry's build step (source-map upload) only runs when the project is
// configured; otherwise the plain config is used and nothing changes.
export default process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
    })
  : nextConfig;
