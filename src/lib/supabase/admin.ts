import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client. It bypasses Row-Level Security, so it is reserved for
// the few things the anon key cannot do — creating, updating and deleting
// auth users for staff accounts — and every caller must have already checked
// the actor's permission. The "server-only" import makes the build fail if a
// client component ever pulls this in.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured; staff accounts cannot be managed.",
    );
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
