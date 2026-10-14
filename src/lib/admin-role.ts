// The two operator levels. The database decides (platform_admins.role and
// platform_admin_role()); this only names them for the pages.
//
//   admin          looks: trial review, activity, plans, leads, a
//                  restaurant's profile.
//   project_owner  also changes money and people: sets plans, sees
//                  payments, adds and removes admins, reads the audit log.

export const ADMIN_ROLES = ["admin", "project_owner"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  admin: "Admin",
  project_owner: "Project owner",
};

export function isProjectOwner(role: AdminRole | null | undefined): boolean {
  return role === "project_owner";
}
