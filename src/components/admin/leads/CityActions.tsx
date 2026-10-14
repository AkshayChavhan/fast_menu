"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Plus } from "lucide-react";

import { createLead, fetchOsmLeads } from "@/app/admin/leads/actions";
import { Modal } from "@/components/dashboard/Modal";
import type { LeadCity } from "@/lib/leads/types";

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800";

// The two ways a restaurant gets onto the list for a city: pulled from
// OpenStreetMap, or typed in by whoever found it.
export function CityActions({ city }: { city: LeadCity }) {
  const [pending, startTransition] = useTransition();
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  function fetchFromOsm() {
    setFetching(true);
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await fetchOsmLeads({ cityId: city.id });
      setFetching(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(
        res.found === 0
          ? `OpenStreetMap has no named restaurants mapped around ${city.name} yet. Add them by hand as you find them.`
          : `${res.found} found on OpenStreetMap, ${res.added} new.`,
      );
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={fetchFromOsm}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          {fetching ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Download className="h-4 w-4" aria-hidden />
          )}
          Fetch from OpenStreetMap
        </button>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add restaurant
        </button>
      </div>
      {message ? <p className="text-sm text-neutral-600 dark:text-neutral-300">{message}</p> : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <AddLeadModal city={city} open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function AddLeadModal({
  city,
  open,
  onClose,
}: {
  city: LeadCity;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setPhone("");
    setWebsite("");
    setAddress("");
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createLead({ cityId: city.id, name, phone, website, address });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reset();
      onClose();
      router.push(`/admin/leads/${res.id}`);
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Add a restaurant in ${city.name}`}>
      <form id="add-lead" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-neutral-500">
          Name
          <input
            className={`${inputClass} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            autoFocus
            placeholder="Hotel Sai Palace"
          />
        </label>
        <label className="block text-xs font-medium text-neutral-500">
          Phone
          <input
            className={`${inputClass} mt-1`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={32}
            inputMode="tel"
            placeholder="98765 43210"
          />
        </label>
        <label className="block text-xs font-medium text-neutral-500">
          Website, if they have one
          <input
            className={`${inputClass} mt-1`}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            maxLength={200}
            inputMode="url"
            placeholder="saipalace.in"
          />
        </label>
        <label className="block text-xs font-medium text-neutral-500">
          Address or landmark
          <input
            className={`${inputClass} mt-1`}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={300}
            placeholder="Opposite the bus stand, College Road"
          />
        </label>
        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Add
          </button>
        </div>
      </form>
    </Modal>
  );
}
