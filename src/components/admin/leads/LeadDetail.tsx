"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Phone, Trash2 } from "lucide-react";

import { deleteLead, logLeadCall, updateLeadDetails } from "@/app/admin/leads/actions";
import { StatusBadge, WebsiteCell } from "@/components/admin/leads/StatusBadge";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  REVISIT_TYPES,
  REVISIT_TYPE_LABELS,
  type Lead,
  type LeadNote,
  type LeadStatus,
  type RevisitType,
  type WebsiteStatus,
} from "@/lib/leads/types";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800";

const cardClass =
  "rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900";

export function LeadDetail({
  lead,
  notes,
  customer,
  currentUserEmail,
}: {
  lead: Lead;
  notes: LeadNote[];
  customer: { name: string; slug: string } | null;
  currentUserEmail: string;
}) {
  return (
    <div className="space-y-6">
      {customer ? (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-200">
          Already a fast_menu customer: <strong>{customer.name}</strong> (/r/{customer.slug}).
          No need to pitch; this is a support conversation.
        </p>
      ) : null}

      <LogCallForm lead={lead} />
      <CallLog notes={notes} />
      <DetailsForm lead={lead} currentUserEmail={currentUserEmail} />
      <DangerZone lead={lead} />
    </div>
  );
}

// --- After the call ----------------------------------------------------------------

function LogCallForm({ lead }: { lead: Lead }) {
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<LeadStatus>(lead.status === "new" ? "reached" : lead.status);
  const [todo, setTodo] = useState(lead.pending ?? "");
  const [revisitAt, setRevisitAt] = useState(lead.revisit_at ?? "");
  const [revisitType, setRevisitType] = useState<RevisitType | "">(lead.revisit_type ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await logLeadCall({
        leadId: lead.id,
        body,
        status,
        pending: todo,
        revisitAt,
        revisitType,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody("");
      setSaved(true);
    });
  }

  return (
    <form onSubmit={submit} className={cn(cardClass, "space-y-3")}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Log a call</h2>
        <StatusBadge status={lead.status} />
      </div>

      <label className="block text-xs font-medium text-neutral-500">
        What was discussed
        <textarea
          className={`${inputClass} mt-1 min-h-[5rem]`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          placeholder="Spoke to the owner. Interested in table QR; wants to see it on their phone first."
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-neutral-500">
          Where it stands now
          <select
            className={`${inputClass} mt-1`}
            value={status}
            onChange={(e) => setStatus(e.target.value as LeadStatus)}
          >
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-neutral-500">
          Still pending
          <input
            className={`${inputClass} mt-1`}
            value={todo}
            onChange={(e) => setTodo(e.target.value)}
            maxLength={500}
            placeholder="Send pricing on WhatsApp"
          />
        </label>
        <label className="block text-xs font-medium text-neutral-500">
          Revisit on
          <input
            type="date"
            className={`${inputClass} mt-1`}
            value={revisitAt}
            onChange={(e) => setRevisitAt(e.target.value)}
          />
        </label>
        <label className="block text-xs font-medium text-neutral-500">
          Revisit as
          <select
            className={`${inputClass} mt-1`}
            value={revisitType}
            disabled={!revisitAt}
            onChange={(e) => setRevisitType(e.target.value as RevisitType | "")}
          >
            <option value="">—</option>
            {REVISIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {REVISIT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        {saved ? <span className="text-xs text-green-700 dark:text-green-300">Saved</span> : null}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Save
        </button>
      </div>
    </form>
  );
}

// --- What was said before ------------------------------------------------------

function CallLog({ notes }: { notes: LeadNote[] }) {
  return (
    <section className={cn(cardClass, "space-y-3")}>
      <h2 className="text-sm font-semibold">
        Call log <span className="font-normal text-neutral-500">({notes.length})</span>
      </h2>
      {notes.length === 0 ? (
        <p className="text-sm text-neutral-500">No calls logged yet.</p>
      ) : (
        <ol className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="border-l-2 border-neutral-200 pl-3 dark:border-neutral-700">
              <div className="text-xs text-neutral-500">
                {n.author ?? "Someone"} · {timeAgo(n.created_at)}
              </div>
              <p className="whitespace-pre-wrap text-sm">{n.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// --- Contact details -------------------------------------------------------------

function DetailsForm({ lead, currentUserEmail }: { lead: Lead; currentUserEmail: string }) {
  const [pending, startTransition] = useTransition();
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [website, setWebsite] = useState(lead.website ?? "");
  const [websiteStatus, setWebsiteStatus] = useState<WebsiteStatus>(lead.website_status);
  const [address, setAddress] = useState(lead.address ?? "");
  const [assignedTo, setAssignedTo] = useState(lead.assigned_to ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateLeadDetails({
        id: lead.id,
        phone,
        website,
        websiteStatus,
        address,
        assignedTo,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <form onSubmit={submit} className={cn(cardClass, "space-y-3")}>
      <h2 className="text-sm font-semibold">Contact details</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-neutral-500">
          Phone
          <div className="mt-1 flex gap-2">
            <input
              className={inputClass}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={32}
              inputMode="tel"
              placeholder="98765 43210"
            />
            {lead.phone ? (
              <a
                href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}
                className="inline-flex items-center rounded-lg border border-neutral-300 px-3 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                aria-label="Call"
              >
                <Phone className="h-4 w-4" aria-hidden />
              </a>
            ) : null}
          </div>
        </label>
        <label className="block text-xs font-medium text-neutral-500">
          Working this lead
          <div className="mt-1 flex gap-2">
            <input
              className={inputClass}
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              maxLength={120}
              placeholder="Name or email"
            />
            {currentUserEmail && assignedTo !== currentUserEmail ? (
              <button
                type="button"
                onClick={() => setAssignedTo(currentUserEmail)}
                className="whitespace-nowrap rounded-lg border border-neutral-300 px-3 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                Me
              </button>
            ) : null}
          </div>
        </label>
        <label className="block text-xs font-medium text-neutral-500 sm:col-span-2">
          Address or landmark
          <input
            className={`${inputClass} mt-1`}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={300}
          />
        </label>
        <label className="block text-xs font-medium text-neutral-500">
          Website
          <input
            className={`${inputClass} mt-1`}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            maxLength={200}
            inputMode="url"
            placeholder="saipalace.in"
          />
        </label>
        <fieldset className="text-xs font-medium text-neutral-500">
          <legend>Do they have a website?</legend>
          <div className="mt-2 flex flex-wrap gap-3 text-sm font-normal text-neutral-800 dark:text-neutral-200">
            {(
              [
                ["unknown", "Not asked yet"],
                ["none", "No — confirmed on the call"],
                ["has", "Yes"],
              ] as [WebsiteStatus, string][]
            ).map(([value, label]) => (
              <label key={value} className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="website-status"
                  value={value}
                  checked={website ? value === "has" : websiteStatus === value}
                  disabled={Boolean(website) && value !== "has"}
                  onChange={() => setWebsiteStatus(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-neutral-500">
        <span>
          Now: <WebsiteCell website={lead.website} status={lead.website_status} />
        </span>
        <div className="flex items-center gap-3">
          {saved ? <span className="text-green-700 dark:text-green-300">Saved</span> : null}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save details
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}

// --- Remove ---------------------------------------------------------------------------

function DangerZone({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    if (!window.confirm(`Remove "${lead.name}" and its call log? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await deleteLead({ id: lead.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/admin/leads");
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 text-xs text-neutral-500">
      <span>
        {lead.source === "osm" ? (
          <>From OpenStreetMap ({lead.osm_ref}). Removing it here only removes it from this list.</>
        ) : (
          <>Added by hand.</>
        )}
        {error ? <span className="ml-2 text-red-700">{error}</span> : null}
      </span>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-60 dark:text-red-300 dark:hover:bg-red-900/30"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        Remove
      </button>
    </div>
  );
}
