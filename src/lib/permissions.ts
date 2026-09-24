// Role → capability map for the whole app.
//
// The database enforces the same rules through RLS policies and role-checked
// functions (see supabase/migrations/*_staff_roles.sql). This map exists so
// the UI can hide what a role can't do and so server actions can fail with a
// friendly message before the database refuses the write. Keep the two in
// step: when a policy changes, change the grant here and the test alongside.

import { STAFF_ROLES, type MemberRole, type StaffRole } from "@/types/db";

export const CAPABILITIES = [
  // Categories, dishes, variants, specials, schedules, disabling items.
  "menu:manage",
  // Whole-menu JSON import.
  "menu:import",
  // Restaurant details, slug, currency, languages, logo, publish, switches.
  "settings:manage",
  // Temporarily stop taking orders ("kitchen closed").
  "ordering:pause",
  // Add, deactivate and remove staff below the actor's own level.
  "staff:manage",
  // Approve / hide guest reviews and edit the review form.
  "reviews:moderate",
  // Billing counter: mark table sessions paid, see the day's history.
  "billing:settle",
  "reports:view",
  // Waiter app: scan, approve, take and edit orders, table board.
  "orders:serve",
  // Kitchen ticket screen.
  "kitchen:view",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const ALL: readonly Capability[] = CAPABILITIES;

const GRANTS: Record<MemberRole, ReadonlySet<Capability>> = {
  owner: new Set(ALL),
  manager: new Set<Capability>([
    "menu:manage",
    "menu:import",
    "ordering:pause",
    "staff:manage",
    "reviews:moderate",
    "billing:settle",
    "reports:view",
    "orders:serve",
    "kitchen:view",
  ]),
  cashier: new Set<Capability>(["billing:settle", "reports:view"]),
  waiter: new Set<Capability>(["orders:serve"]),
  kitchen: new Set<Capability>(["kitchen:view"]),
};

export function can(
  role: MemberRole | null | undefined,
  capability: Capability,
): boolean {
  if (!role) return false;
  return GRANTS[role].has(capability);
}

// Where a freshly signed-in user should land.
export function homeFor(role: MemberRole | null | undefined): string {
  switch (role) {
    case "waiter":
      return "/waiter";
    case "kitchen":
      return "/kitchen";
    case "owner":
    case "manager":
    case "cashier":
      return "/dashboard";
    default:
      return "/login";
  }
}

// Owners manage every staff role; managers manage everyone below manager.
// Mirrors the with-check clause of the staff_manage_write policy.
export function canManageRole(
  actor: MemberRole | null | undefined,
  target: StaffRole,
): boolean {
  if (actor === "owner") return true;
  if (actor === "manager") return target !== "manager";
  return false;
}

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

export function isMemberRole(value: string): value is MemberRole {
  return value === "owner" || isStaffRole(value);
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  waiter: "Waiter",
  kitchen: "Kitchen",
};
