import { describe, it, expect, vi, beforeEach } from "vitest";

import type { MemberRole } from "@/types/db";

// --- Test doubles -----------------------------------------------------------

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  // What requireRestaurantAccess() answers.
  actorRole: "owner" as MemberRole,
  guardError: null as string | null,
  // The restaurant_staff row a select() returns.
  target: null as Row | null,
  insertError: null as { message: string } | null,
  inserted: [] as Row[],
  updated: [] as Row[],
  // Admin API doubles.
  createUserError: null as { message: string } | null,
  createdUsers: [] as Row[],
  deletedUsers: [] as string[],
  // Owners whose starter restaurant createStaff() removed.
  starterRestaurantsRemovedFor: [] as string[],
  passwordUpdates: [] as { uid: string; password: string }[],
  // Storage paths handed to remove().
  removed: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/app/dashboard/lib", () => ({
  requireRestaurantAccess: async () => {
    if (state.guardError) return { ok: false, error: state.guardError };
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: state.target, error: null }),
      insert: (row: Row) => {
        state.inserted.push(row);
        return Promise.resolve({ error: state.insertError });
      },
      update: (patch: Row) => {
        state.updated.push(patch);
        return chain;
      },
      then: undefined,
    };
    // update().eq().eq() is awaited directly, so the chain must be thenable
    // only at the end; give the eq() result a resolved promise shape.
    const awaitable = { ...chain, eq: () => awaitable, then: (r: (v: { error: null }) => void) => r({ error: null }) };
    return {
      ok: true,
      userId: "actor-1",
      role: state.actorRole,
      supabase: {
        from: () => ({
          ...chain,
          update: (patch: Row) => {
            state.updated.push(patch);
            return awaitable;
          },
        }),
        storage: {
          from: () => ({
            remove: async (paths: string[]) => {
              state.removed.push(...paths);
              return { error: null };
            },
          }),
        },
      },
    };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        createUser: async (attrs: Row) => {
          state.createdUsers.push(attrs);
          if (state.createUserError) {
            return { data: { user: null }, error: state.createUserError };
          }
          return { data: { user: { id: "new-user-1" } }, error: null };
        },
        deleteUser: async (id: string) => {
          state.deletedUsers.push(id);
          return { data: {}, error: null };
        },
        updateUserById: async (uid: string, attrs: { password: string }) => {
          state.passwordUpdates.push({ uid, password: attrs.password });
          return { data: {}, error: null };
        },
      },
    },
    from: () => ({
      delete: () => ({
        eq: async (_column: string, ownerId: string) => {
          state.starterRestaurantsRemovedFor.push(ownerId);
          return { error: null };
        },
      }),
    }),
  }),
}));

import {
  createStaff,
  deleteStaff,
  resetStaffPassword,
  setStaffActive,
  setStaffAvatar,
} from "@/app/dashboard/staff/actions";

const RID = "11111111-1111-1111-1111-111111111111";
const SID = "22222222-2222-2222-2222-222222222222";

const PHOTO = "https://abc.supabase.co/storage/v1/object/public/menu-images/r/staff/a.jpg";
const OLD_PATH = "11111111-1111-1111-1111-111111111111/staff/22222222-2222-2222-2222-222222222222/old.jpg";
const OLD_PHOTO = `https://abc.supabase.co/storage/v1/object/public/menu-images/${OLD_PATH}`;

const validCreate = {
  restaurantId: RID,
  displayName: "Ravi",
  email: "Ravi@Example.com",
  password: "correct-horse",
  role: "waiter" as const,
};

beforeEach(() => {
  state.actorRole = "owner";
  state.guardError = null;
  state.target = { id: SID, user_id: "user-9", role: "waiter", avatar_url: null };
  state.insertError = null;
  state.inserted = [];
  state.updated = [];
  state.createUserError = null;
  state.createdUsers = [];
  state.deletedUsers = [];
  state.passwordUpdates = [];
  state.starterRestaurantsRemovedFor = [];
  state.removed = [];
});

describe("createStaff()", () => {
  it("rejects a bad email or short password before touching auth", async () => {
    const bad = await createStaff({ ...validCreate, email: "not-an-email" });
    expect(bad).toEqual({ ok: false, error: "Enter a valid email address" });

    const short = await createStaff({ ...validCreate, password: "short" });
    expect(short.ok).toBe(false);
    expect(state.createdUsers).toHaveLength(0);
  });

  it("refuses when the actor lacks staff:manage", async () => {
    state.guardError = "You don't have permission to do that";
    const res = await createStaff(validCreate);
    expect(res).toEqual({ ok: false, error: "You don't have permission to do that" });
    expect(state.createdUsers).toHaveLength(0);
  });

  it("lets a manager add a waiter but not another manager", async () => {
    state.actorRole = "manager";
    const ok = await createStaff(validCreate);
    expect(ok).toEqual({ ok: true });

    const refused = await createStaff({ ...validCreate, role: "manager" });
    expect(refused).toEqual({ ok: false, error: "Only the owner can add managers" });
    expect(state.createdUsers).toHaveLength(1);
  });

  it("creates a confirmed user tagged with its role, then the staff row", async () => {
    const res = await createStaff(validCreate);
    expect(res).toEqual({ ok: true });

    expect(state.createdUsers).toHaveLength(1);
    const attrs = state.createdUsers[0];
    expect(attrs.email).toBe("ravi@example.com");
    expect(attrs.email_confirm).toBe(true);
    expect(attrs.app_metadata).toEqual({ app_role: "waiter" });
    expect(attrs.user_metadata).toEqual({ full_name: "Ravi", app_role: "waiter" });

    expect(state.inserted).toEqual([
      {
        restaurant_id: RID,
        user_id: "new-user-1",
        role: "waiter",
        display_name: "Ravi",
        email: "ravi@example.com",
        avatar_url: null,
        created_by: "actor-1",
      },
    ]);
  });

  // The signup trigger reads the hint from user_metadata because the Auth
  // server writes app_metadata only after the insert; and whatever the
  // database did, a staff login must not own a restaurant afterwards.
  it("marks the login as staff in both metadata fields and removes any starter restaurant", async () => {
    const res = await createStaff(validCreate);
    expect(res).toEqual({ ok: true });
    expect(state.createdUsers[0].user_metadata).toEqual({ full_name: "Ravi", app_role: "waiter" });
    expect(state.createdUsers[0].app_metadata).toEqual({ app_role: "waiter" });
    expect(state.starterRestaurantsRemovedFor).toEqual(["new-user-1"]);
  });

  it("keeps a photo chosen while creating the account", async () => {
    const res = await createStaff({ ...validCreate, avatarUrl: PHOTO });
    expect(res).toEqual({ ok: true });
    expect(state.inserted[0].avatar_url).toBe(PHOTO);

    const bad = await createStaff({ ...validCreate, avatarUrl: "not a url" });
    expect(bad.ok).toBe(false);
    expect(state.createdUsers).toHaveLength(1);
  });

  it("deletes the new login again if the staff row cannot be written", async () => {
    state.insertError = { message: "new row violates row-level security policy" };
    const res = await createStaff(validCreate);
    expect(res.ok).toBe(false);
    expect(state.deletedUsers).toEqual(["new-user-1"]);
  });

  it("explains a duplicate email in plain words", async () => {
    state.createUserError = { message: "A user with this email address has already been registered" };
    const res = await createStaff(validCreate);
    expect(res).toEqual({ ok: false, error: "An account with this email already exists." });
    expect(state.inserted).toHaveLength(0);
  });
});

describe("setStaffActive()", () => {
  it("updates the row for a manageable target", async () => {
    const res = await setStaffActive({ restaurantId: RID, staffId: SID, isActive: false });
    expect(res).toEqual({ ok: true });
    expect(state.updated).toEqual([{ is_active: false }]);
  });

  it("stops a manager from touching another manager", async () => {
    state.actorRole = "manager";
    state.target = { id: SID, user_id: "user-9", role: "manager" };
    const res = await setStaffActive({ restaurantId: RID, staffId: SID, isActive: false });
    expect(res).toEqual({ ok: false, error: "Only the owner can change a manager" });
    expect(state.updated).toHaveLength(0);
  });

  it("reports a missing target", async () => {
    state.target = null;
    const res = await setStaffActive({ restaurantId: RID, staffId: SID, isActive: true });
    expect(res).toEqual({ ok: false, error: "Staff member not found" });
  });
});

describe("setStaffAvatar()", () => {
  it("stores the photo URL on a manageable target", async () => {
    const res = await setStaffAvatar({ restaurantId: RID, staffId: SID, avatarUrl: PHOTO });
    expect(res).toEqual({ ok: true });
    expect(state.updated).toEqual([{ avatar_url: PHOTO }]);
  });

  it("clears the photo with null", async () => {
    const res = await setStaffAvatar({ restaurantId: RID, staffId: SID, avatarUrl: null });
    expect(res).toEqual({ ok: true });
    expect(state.updated).toEqual([{ avatar_url: null }]);
  });

  it("deletes the previous file once the new URL is stored", async () => {
    state.target = { id: SID, user_id: "user-9", role: "waiter", avatar_url: OLD_PHOTO };
    await setStaffAvatar({ restaurantId: RID, staffId: SID, avatarUrl: PHOTO });
    expect(state.removed).toEqual([OLD_PATH]);

    state.removed = [];
    await setStaffAvatar({ restaurantId: RID, staffId: SID, avatarUrl: null });
    expect(state.removed).toEqual([OLD_PATH]);
  });

  it("leaves the file alone when the URL has not changed", async () => {
    state.target = { id: SID, user_id: "user-9", role: "waiter", avatar_url: OLD_PHOTO };
    await setStaffAvatar({ restaurantId: RID, staffId: SID, avatarUrl: OLD_PHOTO });
    expect(state.removed).toEqual([]);
  });

  it("never deletes a file outside this restaurant's folder", async () => {
    state.target = {
      id: SID,
      user_id: "user-9",
      role: "waiter",
      avatar_url: "https://abc.supabase.co/storage/v1/object/public/menu-images/other/staff/x.jpg",
    };
    await setStaffAvatar({ restaurantId: RID, staffId: SID, avatarUrl: PHOTO });
    expect(state.removed).toEqual([]);
  });

  it("rejects anything that is not a URL", async () => {
    const res = await setStaffAvatar({ restaurantId: RID, staffId: SID, avatarUrl: "ravi.jpg" });
    expect(res).toEqual({ ok: false, error: "Invalid photo URL" });
    expect(state.updated).toHaveLength(0);
  });

  it("stops a manager from changing another manager's photo", async () => {
    state.actorRole = "manager";
    state.target = { id: SID, user_id: "user-9", role: "manager" };
    const res = await setStaffAvatar({ restaurantId: RID, staffId: SID, avatarUrl: PHOTO });
    expect(res).toEqual({ ok: false, error: "Only the owner can change a manager" });
    expect(state.updated).toHaveLength(0);
  });

  it("refuses when the actor lacks staff:manage", async () => {
    state.guardError = "You don't have permission to do that";
    const res = await setStaffAvatar({ restaurantId: RID, staffId: SID, avatarUrl: PHOTO });
    expect(res).toEqual({ ok: false, error: "You don't have permission to do that" });
  });
});

describe("resetStaffPassword()", () => {
  it("validates the password length", async () => {
    const res = await resetStaffPassword({ restaurantId: RID, staffId: SID, password: "tiny" });
    expect(res.ok).toBe(false);
    expect(state.passwordUpdates).toHaveLength(0);
  });

  it("sets the password on the target's auth user", async () => {
    const res = await resetStaffPassword({ restaurantId: RID, staffId: SID, password: "new-password-1" });
    expect(res).toEqual({ ok: true });
    expect(state.passwordUpdates).toEqual([{ uid: "user-9", password: "new-password-1" }]);
  });
});

describe("deleteStaff()", () => {
  it("deletes the target's auth user, which cascades to the row", async () => {
    const res = await deleteStaff({ restaurantId: RID, staffId: SID });
    expect(res).toEqual({ ok: true });
    expect(state.deletedUsers).toEqual(["user-9"]);
    expect(state.removed).toEqual([]);
  });

  it("removes the photo file along with the account", async () => {
    state.target = { id: SID, user_id: "user-9", role: "waiter", avatar_url: OLD_PHOTO };
    await deleteStaff({ restaurantId: RID, staffId: SID });
    expect(state.removed).toEqual([OLD_PATH]);
  });

  it("refuses a manager deleting a manager", async () => {
    state.actorRole = "manager";
    state.target = { id: SID, user_id: "user-9", role: "manager" };
    const res = await deleteStaff({ restaurantId: RID, staffId: SID });
    expect(res.ok).toBe(false);
    expect(state.deletedUsers).toHaveLength(0);
  });
});
