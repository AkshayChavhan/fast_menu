import "server-only";

import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isAdminRole, type AdminRole } from "@/lib/admin-role";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface AdminContext {
  supabase: Db;
  user: { id: string; email: string | null };
  role: AdminRole;
}

// The gate on every operator page. Not signed in: to the login and back.
// Signed in but not in platform_admins: a 404, so the pages' existence is
// not advertised.
export async function requireAdmin(next: string): Promise<AdminContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);

  const { data: role } = await supabase.rpc("platform_admin_role");
  if (!isAdminRole(role)) notFound();

  return { supabase, user: { id: user.id, email: user.email ?? null }, role };
}

// Pages that change money or people. An admin who types the URL gets the
// same 404 a stranger would.
export async function requireProjectOwner(next: string): Promise<AdminContext> {
  const ctx = await requireAdmin(next);
  if (ctx.role !== "project_owner") notFound();
  return ctx;
}
