// The plans the platform runs on and what each allows. Vendors keep most of
// their meters in their own dashboards (no API), so this file holds the
// limits as typed numbers, the app measures what it can, and the page links
// out for the rest. Change HOSTING_PROVIDER / HOSTING_PLAN / SUPABASE_PLAN
// in the environment when you upgrade; the limits follow.
//
// Figures are from the vendors' pricing pages as of October 2026 and are
// the thing most likely to drift: when one looks wrong, check the page.

export const GB = 1024 ** 3;
export const MB = 1024 ** 2;

export type HostingProvider = "vercel" | "netlify";
export type HostingPlan = "hobby" | "free" | "pro";
export type SupabasePlan = "free" | "pro";

export interface Limit {
  label: string;
  // null = unlimited / not metered on this plan.
  limit: number | null;
  unit: "bytes" | "count" | "credits" | "minutes";
  note?: string;
}

export interface SupabaseLimits {
  plan: SupabasePlan;
  priceUsd: number;
  database: Limit;
  storage: Limit;
  egress: Limit;
  realtimeConnections: Limit;
  realtimeMessages: Limit;
  backups: string;
  dashboard: string;
}

export const SUPABASE_LIMITS: Record<SupabasePlan, SupabaseLimits> = {
  free: {
    plan: "free",
    priceUsd: 0,
    database: { label: "Database", limit: 500 * MB, unit: "bytes" },
    storage: { label: "Image storage", limit: 1 * GB, unit: "bytes" },
    egress: { label: "Egress", limit: 5 * GB, unit: "bytes", note: "plus 5 GB cached" },
    realtimeConnections: { label: "Realtime peak connections", limit: 200, unit: "count" },
    realtimeMessages: { label: "Realtime messages / month", limit: 2_000_000, unit: "count" },
    backups: "none — projects also pause after 7 idle days",
    dashboard: "https://supabase.com/dashboard/project/_/settings/usage",
  },
  pro: {
    plan: "pro",
    priceUsd: 25,
    database: { label: "Database", limit: 8 * GB, unit: "bytes" },
    storage: { label: "Image storage", limit: 100 * GB, unit: "bytes" },
    egress: { label: "Egress", limit: 250 * GB, unit: "bytes" },
    realtimeConnections: { label: "Realtime peak connections", limit: 500, unit: "count" },
    realtimeMessages: { label: "Realtime messages / month", limit: 5_000_000, unit: "count" },
    backups: "daily, 7-day retention",
    dashboard: "https://supabase.com/dashboard/project/_/settings/usage",
  },
};

export interface HostingLimits {
  provider: HostingProvider;
  plan: HostingPlan;
  priceUsd: number;
  commercialUse: boolean;
  bandwidth: Limit;
  credits: Limit | null;
  functions: Limit;
  images: Limit;
  dashboard: string;
}

export const HOSTING_LIMITS: Record<HostingProvider, Partial<Record<HostingPlan, HostingLimits>>> = {
  vercel: {
    hobby: {
      provider: "vercel",
      plan: "hobby",
      priceUsd: 0,
      commercialUse: false,
      bandwidth: { label: "Fast data transfer", limit: 100 * GB, unit: "bytes", note: "hard cap — the site pauses" },
      credits: null,
      functions: { label: "Function invocations", limit: 1_000_000, unit: "count" },
      images: { label: "Image optimizations", limit: 1_000, unit: "count", note: "source images" },
      dashboard: "https://vercel.com/dashboard/usage",
    },
    pro: {
      provider: "vercel",
      plan: "pro",
      priceUsd: 20,
      commercialUse: true,
      bandwidth: { label: "Fast data transfer", limit: 1024 * GB, unit: "bytes" },
      credits: null,
      functions: { label: "Function invocations", limit: 10_000_000, unit: "count" },
      images: { label: "Image optimizations", limit: 5_000, unit: "count", note: "source images" },
      dashboard: "https://vercel.com/dashboard/usage",
    },
  },
  netlify: {
    free: {
      provider: "netlify",
      plan: "free",
      priceUsd: 0,
      commercialUse: true,
      bandwidth: { label: "Bandwidth", limit: null, unit: "bytes", note: "20 credits per GB" },
      credits: { label: "Credits / month", limit: 300, unit: "credits", note: "15 per production deploy; hard cap" },
      functions: { label: "Compute", limit: null, unit: "count", note: "10 credits per GB-hour" },
      images: { label: "Image CDN", limit: null, unit: "count", note: "counted as bandwidth" },
      dashboard: "https://app.netlify.com/teams/_/billing",
    },
    pro: {
      provider: "netlify",
      plan: "pro",
      priceUsd: 20,
      commercialUse: true,
      bandwidth: { label: "Bandwidth", limit: null, unit: "bytes", note: "20 credits per GB" },
      credits: { label: "Credits / month", limit: 3_000, unit: "credits", note: "per Netlify's 2026 pricing; verify" },
      functions: { label: "Compute", limit: null, unit: "count", note: "10 credits per GB-hour" },
      images: { label: "Image CDN", limit: null, unit: "count", note: "counted as bandwidth" },
      dashboard: "https://app.netlify.com/teams/_/billing",
    },
  },
};

export const GITHUB_ACTIONS_FREE_MINUTES = 2_000;
export const SENTRY_FREE_ERRORS = 5_000;
export const RAZORPAY_FEE_RATE = 0.0236; // 2% + 18% GST on the fee

// --- Configuration from the environment --------------------------------------

export interface InfraConfig {
  hosting: HostingLimits;
  supabase: SupabaseLimits;
  // Set when the hosting/plan env vars were missing, so the page can say so.
  assumed: string[];
}

// A plain map rather than NodeJS.ProcessEnv so a test can pass three keys.
export type EnvMap = Record<string, string | undefined>;

export function readInfraConfig(env: EnvMap = process.env): InfraConfig {
  const assumed: string[] = [];

  let provider = (env.HOSTING_PROVIDER ?? "").trim().toLowerCase() as HostingProvider;
  if (provider !== "vercel" && provider !== "netlify") {
    provider = env.VERCEL ? "vercel" : env.NETLIFY ? "netlify" : "vercel";
    assumed.push(`HOSTING_PROVIDER (assumed ${provider})`);
  }
  let plan = (env.HOSTING_PLAN ?? "").trim().toLowerCase() as HostingPlan;
  if (!HOSTING_LIMITS[provider][plan]) {
    plan = provider === "vercel" ? "hobby" : "free";
    assumed.push(`HOSTING_PLAN (assumed ${plan})`);
  }
  let sb = (env.SUPABASE_PLAN ?? "").trim().toLowerCase() as SupabasePlan;
  if (sb !== "free" && sb !== "pro") {
    sb = "free";
    assumed.push("SUPABASE_PLAN (assumed free)");
  }

  return { hosting: HOSTING_LIMITS[provider][plan]!, supabase: SUPABASE_LIMITS[sb], assumed };
}

// --- Arithmetic ---------------------------------------------------------------

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(n >= 100 * MB ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function formatCount(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-IN");
}

/** 0–100, or null when either side is unknown or the limit is unlimited. */
export function percentUsed(used: number | null | undefined, limit: number | null | undefined): number | null {
  if (used == null || limit == null || limit <= 0) return null;
  return Math.min(100, Math.round((used / limit) * 1000) / 10);
}

export type Tone = "ok" | "warn" | "danger" | "unknown";

// Green under 60%, amber to 85%, red beyond: the amber band is where to
// plan an upgrade, red is where to do it this week.
export function toneFor(pct: number | null): Tone {
  if (pct == null) return "unknown";
  if (pct >= 85) return "danger";
  if (pct >= 60) return "warn";
  return "ok";
}

/**
 * Months until `limit` at the current growth, or null when it cannot be
 * known (no growth, no limit). Capped at 120 so a quiet install does not
 * claim "full in 9,000 months".
 */
export function monthsUntilFull(
  used: number | null | undefined,
  limit: number | null | undefined,
  growthPerMonth: number | null | undefined,
): number | null {
  if (used == null || limit == null || growthPerMonth == null || growthPerMonth <= 0) return null;
  const remaining = limit - used;
  if (remaining <= 0) return 0;
  return Math.min(120, Math.round((remaining / growthPerMonth) * 10) / 10);
}
