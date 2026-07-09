import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /auth/signout — clears the Supabase session, then sends the user home.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/", request.url), {
    status: 303,
  });
}
