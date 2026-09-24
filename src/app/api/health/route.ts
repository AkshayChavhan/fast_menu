import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/health — for uptime checks. 200 when the app can reach the
// database, 503 otherwise. Reads one public row through RLS so it also
// proves the anon key and policies are in place.
export async function GET() {
  const startedAt = Date.now();
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("restaurants")
      .select("id", { head: true, count: "exact" })
      .limit(1);
    if (error) throw error;
    return NextResponse.json(
      { ok: true, db: "ok", ms: Date.now() - startedAt, time: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        db: "unreachable",
        error: err instanceof Error ? err.message : String(err),
        time: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
