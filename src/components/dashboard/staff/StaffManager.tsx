"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
} from "lucide-react";

import {
  createStaff,
  deleteStaff,
  resetStaffPassword,
  setStaffActive,
  setStaffAvatar,
} from "@/app/dashboard/staff/actions";
import { canManageRole, ROLE_LABELS } from "@/lib/permissions";
import { STAFF_ROLES, type MemberRole, type RestaurantStaff, type StaffRole } from "@/types/db";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/dashboard/Modal";
import { Switch } from "@/components/dashboard/Switch";
import { ImageUpload } from "@/components/dashboard/ImageUpload";
import { StaffAvatar } from "@/components/dashboard/staff/StaffAvatar";

const ROLE_BLURB: Record<StaffRole, string> = {
  manager: "Menu, staff, billing and the floor. Not settings.",
  cashier: "Billing counter and reports only.",
  waiter: "The waiter app: scan, approve, take and edit orders.",
  kitchen: "The kitchen ticket screen.",
};

// Unambiguous characters only, so a password read out loud at the counter
// survives the trip.
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(length = 10): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => PASSWORD_ALPHABET[n % PASSWORD_ALPHABET.length]).join("");
}

export function StaffManager({
  restaurantId,
  actorRole,
  staff,
}: {
  restaurantId: string;
  actorRole: MemberRole;
  staff: RestaurantStaff[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<RestaurantStaff | null>(null);
  const [photoFor, setPhotoFor] = useState<RestaurantStaff | null>(null);

  const allowedRoles = STAFF_ROLES.filter((r) => canManageRole(actorRole, r));

  function run(id: string | null, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else router.refresh();
    });
  }

  const toggleActive = (member: RestaurantStaff, next: boolean) =>
    run(member.id, () =>
      setStaffActive({ restaurantId, staffId: member.id, isActive: next }),
    );

  const remove = (member: RestaurantStaff) => {
    const name = member.display_name || member.email || "this account";
    if (!window.confirm(`Remove ${name}? Their login stops working immediately.`)) return;
    run(member.id, () => deleteStaff({ restaurantId, staffId: member.id }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">
          {staff.length === 0
            ? "No staff accounts yet."
            : `${staff.length} ${staff.length === 1 ? "account" : "accounts"}`}
        </p>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add staff
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      {staff.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-14 text-center dark:border-neutral-700">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-950/50">
            <UserRound className="h-6 w-6" aria-hidden />
          </div>
          <h2 className="text-sm font-semibold">Add your first waiter</h2>
          <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-500">
            Each account gets an email and password you choose. Share them
            with the person; they sign in at the same login page and land in
            the right app for their role.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {staff.map((member) => {
            const busy = busyId === member.id && pending;
            const manageable = canManageRole(actorRole, member.role);
            return (
              <li
                key={member.id}
                className={cn(
                  "rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900",
                  !member.is_active && "opacity-70",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <StaffAvatar
                    src={member.avatar_url}
                    name={member.display_name || member.email}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">
                        {member.display_name || member.email || "Unnamed"}
                      </span>
                      <RoleBadge role={member.role} />
                      {!member.is_active ? (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                          Deactivated
                        </span>
                      ) : null}
                    </div>
                    {member.email ? (
                      <p className="mt-0.5 truncate text-xs text-neutral-500">
                        {member.email}
                      </p>
                    ) : null}
                  </div>

                  {manageable ? (
                    <div className="flex items-center gap-2">
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin text-neutral-400" aria-hidden />
                      ) : null}
                      <Switch
                        size="sm"
                        tone="green"
                        checked={member.is_active}
                        disabled={busy}
                        onChange={(next) => toggleActive(member, next)}
                        label={`${member.is_active ? "Deactivate" : "Activate"} ${member.display_name ?? member.email ?? "account"}`}
                      />
                      <button
                        type="button"
                        onClick={() => setPhotoFor(member)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        <Camera className="h-3.5 w-3.5" aria-hidden /> Photo
                      </button>
                      <button
                        type="button"
                        onClick={() => setResetting(member)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        <KeyRound className="h-3.5 w-3.5" aria-hidden /> Password
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(member)}
                        disabled={busy}
                        aria-label={`Remove ${member.display_name ?? member.email ?? "account"}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-neutral-400">Managed by the owner</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AddStaffModal
        open={adding}
        onClose={() => setAdding(false)}
        restaurantId={restaurantId}
        roles={allowedRoles}
      />

      <ResetPasswordModal
        member={resetting}
        onClose={() => setResetting(null)}
        restaurantId={restaurantId}
      />

      <StaffPhotoModal
        member={photoFor}
        onClose={() => setPhotoFor(null)}
        restaurantId={restaurantId}
      />
    </div>
  );
}

function RoleBadge({ role }: { role: StaffRole }) {
  return (
    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
      {ROLE_LABELS[role]}
    </span>
  );
}

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800";

function AddStaffModal({
  open,
  onClose,
  restaurantId,
  roles,
}: {
  open: boolean;
  onClose: () => void;
  restaurantId: string;
  roles: readonly StaffRole[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [role, setRole] = useState<StaffRole>(roles.includes("waiter") ? "waiter" : roles[0]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDisplayName("");
    setEmail("");
    setPassword(generatePassword());
    setRole(roles.includes("waiter") ? "waiter" : roles[0]);
    setAvatarUrl(null);
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createStaff({
        restaurantId,
        displayName,
        email,
        password,
        role,
        avatarUrl,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      close();
    });
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add staff"
      footer={
        <>
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="add-staff-form"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Create account
          </button>
        </>
      }
    >
      <form id="add-staff-form" onSubmit={submit} className="space-y-4">
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Photo <span className="font-normal text-neutral-400">(optional)</span>
          </p>
          <ImageUpload
            pathPrefix={`${restaurantId}/staff`}
            value={avatarUrl}
            onChange={setAvatarUrl}
            shape="round"
            label="photo"
          />
        </div>

        <Field label="Name" htmlFor="staff-name">
          <input
            id="staff-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={80}
            autoComplete="off"
            className={inputClass}
            placeholder="Ravi"
          />
        </Field>

        <Field label="Role" htmlFor="staff-role">
          <select
            id="staff-role"
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            className={inputClass}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-neutral-400">{ROLE_BLURB[role]}</p>
        </Field>

        <Field label="Login email" htmlFor="staff-email">
          <input
            id="staff-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="off"
            className={inputClass}
            placeholder="ravi@example.com"
          />
        </Field>

        <Field label="Password" htmlFor="staff-password">
          <div className="flex gap-2">
            <input
              id="staff-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className={cn(inputClass, "font-mono")}
            />
            <button
              type="button"
              onClick={() => setPassword(generatePassword())}
              aria-label="Generate a new password"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">
            Write this down for them; it is not shown again.
          </p>
        </Field>

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function ResetPasswordModal({
  member,
  onClose,
  restaurantId,
}: {
  member: RestaurantStaff | null;
  onClose: () => void;
  restaurantId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState(() => generatePassword());
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setPassword(generatePassword());
    setDone(false);
    setError(null);
    onClose();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!member) return;
    setError(null);
    startTransition(async () => {
      const res = await resetStaffPassword({ restaurantId, staffId: member.id, password });
      if (!res.ok) setError(res.error);
      else setDone(true);
    });
  }

  const name = member?.display_name || member?.email || "this account";

  return (
    <Modal
      open={member !== null}
      onClose={close}
      title={`New password for ${name}`}
      footer={
        done ? (
          <button
            type="button"
            onClick={close}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="reset-password-form"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Set password
            </button>
          </>
        )
      }
    >
      {done ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          The password is now <span className="font-mono font-semibold">{password}</span>.
          Share it with {name}; their old password no longer works.
        </p>
      ) : (
        <form id="reset-password-form" onSubmit={submit} className="space-y-4">
          <Field label="New password" htmlFor="reset-password">
            <div className="flex gap-2">
              <input
                id="reset-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className={cn(inputClass, "font-mono")}
              />
              <button
                type="button"
                onClick={() => setPassword(generatePassword())}
                aria-label="Generate a new password"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </Field>
          {error ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  );
}

function StaffPhotoModal({
  member,
  onClose,
  restaurantId,
}: {
  member: RestaurantStaff | null;
  onClose: () => void;
  restaurantId: string;
}) {
  const name = member?.display_name || member?.email || "this account";
  return (
    <Modal
      open={member !== null}
      onClose={onClose}
      title={`Photo for ${name}`}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Done
        </button>
      }
    >
      {member ? (
        // Keyed by member so the preview state starts fresh for each person.
        <PhotoEditor key={member.id} member={member} restaurantId={restaurantId} />
      ) : null}
    </Modal>
  );
}

// Each upload or removal saves straight away; there is no separate Save
// button, so a closed modal never loses a change.
function PhotoEditor({
  member,
  restaurantId,
}: {
  member: RestaurantStaff;
  restaurantId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(member.avatar_url);
  const [error, setError] = useState<string | null>(null);

  function save(next: string | null) {
    setError(null);
    const previous = url;
    setUrl(next);
    startTransition(async () => {
      const res = await setStaffAvatar({
        restaurantId,
        staffId: member.id,
        avatarUrl: next,
      });
      if (!res.ok) {
        setUrl(previous);
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <ImageUpload
        pathPrefix={`${restaurantId}/staff/${member.id}`}
        value={url}
        onChange={save}
        shape="round"
        label="photo"
      />
      <p className="flex items-center gap-1.5 text-xs text-neutral-500">
        {pending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving…
          </>
        ) : (
          "Shown next to their name on the roster. Changes save straight away."
        )}
      </p>
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
