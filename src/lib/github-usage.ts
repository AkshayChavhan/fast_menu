// GitHub Actions minutes, the one vendor meter with a documented API.
// Optional: without a token the page links to the billing tab instead.

import "server-only";

export interface GithubActionsUsage {
  usedMinutes: number;
  includedMinutes: number;
  paidMinutes: number;
}

export async function fetchGithubActionsUsage(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubActionsUsage | null> {
  const token = env.GITHUB_USAGE_TOKEN?.trim();
  const owner = env.GITHUB_BILLING_OWNER?.trim();
  if (!token || !owner) return null;

  // A user account and an organisation have different paths.
  const kind = env.GITHUB_BILLING_OWNER_KIND?.trim().toLowerCase() === "org" ? "orgs" : "users";
  const res = await fetchImpl(`https://api.github.com/${kind}/${owner}/settings/billing/actions`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    // The meter moves by the minute, the page by the hour.
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const j = (await res.json()) as {
    total_minutes_used?: number;
    included_minutes?: number;
    total_paid_minutes_used?: number;
  };
  return {
    usedMinutes: j.total_minutes_used ?? 0,
    includedMinutes: j.included_minutes ?? 0,
    paidMinutes: j.total_paid_minutes_used ?? 0,
  };
}
