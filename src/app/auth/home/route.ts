import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveMembership } from "@/lib/membership";
import { homeFor } from "@/lib/permissions";

// GET /auth/home — send the signed-in user to the app for their role: owners,
// managers and cashiers to the dashboard, waiters to /waiter, kitchen staff
// to /kitchen. A session with no active membership (a deactivated staff
// account, or a broken provisioning trigger) is signed out and told why, so
// nobody is stuck on a page that cannot load.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const membership = await resolveMembership(supabase, user.id);
  if (!membership) {
    await supabase.auth.signOut();
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "no_access");
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(new URL(homeFor(membership.role), request.url));
}
