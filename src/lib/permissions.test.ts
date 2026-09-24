import { describe, it, expect } from "vitest";

import {
  CAPABILITIES,
  can,
  canManageRole,
  homeFor,
  isStaffRole,
  type Capability,
} from "@/lib/permissions";
import { STAFF_ROLES, type MemberRole } from "@/types/db";

const ROLES: MemberRole[] = ["owner", ...STAFF_ROLES];

function grantedTo(role: MemberRole): Capability[] {
  return CAPABILITIES.filter((c) => can(role, c));
}

describe("can()", () => {
  it("gives the owner every capability", () => {
    expect(grantedTo("owner")).toEqual([...CAPABILITIES]);
  });

  it("withholds settings from managers but grants the rest of the back office", () => {
    expect(can("manager", "settings:manage")).toBe(false);
    for (const c of [
      "menu:manage",
      "menu:import",
      "ordering:pause",
      "staff:manage",
      "reviews:moderate",
      "billing:settle",
      "reports:view",
      "orders:serve",
      "kitchen:view",
    ] as const) {
      expect(can("manager", c), c).toBe(true);
    }
  });

  it("limits cashiers to billing and reports", () => {
    expect(grantedTo("cashier")).toEqual(["billing:settle", "reports:view"]);
  });

  it("limits waiters to serving orders", () => {
    expect(grantedTo("waiter")).toEqual(["orders:serve"]);
  });

  it("limits kitchen staff to the kitchen screen", () => {
    expect(grantedTo("kitchen")).toEqual(["kitchen:view"]);
  });

  it("grants nothing to a missing role", () => {
    for (const c of CAPABILITIES) {
      expect(can(null, c)).toBe(false);
      expect(can(undefined, c)).toBe(false);
    }
  });

  it("keeps the menu editable only by owner and manager", () => {
    const editors = ROLES.filter((r) => can(r, "menu:manage"));
    expect(editors).toEqual(["owner", "manager"]);
  });
});

describe("homeFor()", () => {
  it("sends back-office roles to the dashboard", () => {
    expect(homeFor("owner")).toBe("/dashboard");
    expect(homeFor("manager")).toBe("/dashboard");
    expect(homeFor("cashier")).toBe("/dashboard");
  });

  it("sends waiters and kitchen to their own apps", () => {
    expect(homeFor("waiter")).toBe("/waiter");
    expect(homeFor("kitchen")).toBe("/kitchen");
  });

  it("sends an unknown role back to login", () => {
    expect(homeFor(null)).toBe("/login");
  });
});

describe("canManageRole()", () => {
  it("lets the owner manage every staff role", () => {
    for (const r of STAFF_ROLES) expect(canManageRole("owner", r)).toBe(true);
  });

  it("lets a manager manage everyone except other managers", () => {
    expect(canManageRole("manager", "manager")).toBe(false);
    expect(canManageRole("manager", "cashier")).toBe(true);
    expect(canManageRole("manager", "waiter")).toBe(true);
    expect(canManageRole("manager", "kitchen")).toBe(true);
  });

  it("lets nobody else manage staff", () => {
    for (const actor of ["cashier", "waiter", "kitchen", null] as const) {
      for (const r of STAFF_ROLES) expect(canManageRole(actor, r)).toBe(false);
    }
  });
});

describe("isStaffRole()", () => {
  it("accepts the four staff roles and nothing else", () => {
    for (const r of STAFF_ROLES) expect(isStaffRole(r)).toBe(true);
    expect(isStaffRole("owner")).toBe(false);
    expect(isStaffRole("admin")).toBe(false);
    expect(isStaffRole("")).toBe(false);
  });
});
