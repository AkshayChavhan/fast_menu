import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// The anon client with no cookies and no session, for pages a guest reads:
// the public menu and the review page. RLS applies exactly as it would to a
// signed-out browser. Because it never touches cookies(), a page using it
// can be cached, which the cookie-aware server client makes impossible.
let client: SupabaseClient | null = null;

export function createPublicClient(): SupabaseClient {
  if (!client) {
    client = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
  }
  return client;
}
