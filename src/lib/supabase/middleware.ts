import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Areas that need a session. Which role may use each one is decided by the
// area's own layout; here we only know whether someone is signed in.
const PROTECTED_PREFIXES = ["/dashboard", "/waiter", "/kitchen", "/onboarding", "/admin"];

// Exported for tests: the whole redirect gate hangs off this predicate, and
// getting it wrong locks every visitor out of the site rather than failing
// quietly. A prefix matches the area's own path or anything beneath it —
// checking the trailing slash keeps "/dashboardish" from counting as
// "/dashboard", and keeps public pages like /login out of the gate entirely.
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// Supabase's session cookie, possibly chunked (sb-<ref>-auth-token.0, .1).
// A request without one has nobody to refresh: a guest scanning a QR code.
export function hasSessionCookie(cookieNames: string[]): boolean {
  return cookieNames.some((name) => name.startsWith("sb-") && name.includes("-auth-token"));
}

// Refreshes the Supabase auth session and guards the signed-in areas
// (dashboard, waiter app, kitchen screen). Called from the root proxy.ts
// (Next.js 16 renamed the middleware convention to proxy; this helper keeps
// the Supabase docs name). A request with no session cookie skips the round
// trip to Supabase Auth entirely — most requests are guests reading a menu.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const { pathname } = request.nextUrl;
  if (!hasSessionCookie(request.cookies.getAll().map((c) => c.name))) {
    if (isProtectedPath(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtectedPath(pathname) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
