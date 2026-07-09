"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Link2 } from "lucide-react";
import type { Restaurant } from "@/types/db";
import { CURRENCIES, SUPPORTED_LOCALES } from "@/lib/constants";
import { slugify } from "@/lib/utils";
import { ChipSelect } from "@/components/dashboard/ChipSelect";
import { ImageUpload } from "@/components/dashboard/ImageUpload";
import { PublishToggle } from "@/components/dashboard/PublishToggle";
import {
  updateRestaurantSettings,
  updateLogo,
  type ActionResult,
} from "@/app/dashboard/settings/actions";

const LOCALE_LABEL = new Map<string, string>(
  SUPPORTED_LOCALES.map((l) => [l.code, l.label]),
);

export function SettingsForm({
  restaurant,
  origin,
}: {
  restaurant: Restaurant;
  origin: string;
}) {
  const router = useRouter();

  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(updateRestaurantSettings, null);

  const [slug, setSlug] = useState(restaurant.slug);
  const [defaultLocale, setDefaultLocale] = useState(restaurant.default_locale);
  const [locales, setLocales] = useState<string[]>(restaurant.locales);

  // Refresh server components after a successful save so other pages reflect
  // the new name/slug/currency.
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  // Ensure default locale stays selected in the offered set.
  useEffect(() => {
    if (!locales.includes(defaultLocale)) {
      setLocales((prev) => [defaultLocale, ...prev]);
    }
  }, [defaultLocale, locales]);

  async function saveLogo(url: string | null) {
    await updateLogo(restaurant.id, url);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Publish */}
      <Card title="Visibility">
        <PublishToggle
          restaurantId={restaurant.id}
          initial={restaurant.is_published}
        />
      </Card>

      {/* Logo */}
      <Card title="Logo">
        <ImageUpload
          pathPrefix={`${restaurant.id}/logo`}
          value={restaurant.logo_url}
          onChange={saveLogo}
          label="logo"
        />
      </Card>

      {/* Details form */}
      <form action={formAction}>
        <input type="hidden" name="restaurantId" value={restaurant.id} />

        <Card
          title="Restaurant details"
          footer={
            <div className="flex items-center gap-3">
              {state?.ok && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                  <Check className="h-3.5 w-3.5" /> Saved
                </span>
              )}
              {state && !state.ok && (
                <span className="text-xs text-red-600">{state.error}</span>
              )}
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save changes
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <Field label="Name" required>
              <input
                name="name"
                type="text"
                required
                defaultValue={restaurant.name}
                maxLength={120}
                className={inputClass}
              />
            </Field>

            <Field label="Public URL slug" required>
              <div className="flex items-stretch overflow-hidden rounded-lg border border-neutral-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30 dark:border-neutral-700">
                <span className="flex items-center gap-1 whitespace-nowrap bg-neutral-50 px-3 text-xs text-neutral-500 dark:bg-neutral-800">
                  <Link2 className="h-3 w-3" />
                  {origin.replace(/^https?:\/\//, "")}/m/
                </span>
                <input
                  name="slug"
                  type="text"
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  onBlur={(e) => setSlug(slugify(e.target.value))}
                  className="min-w-0 flex-1 bg-white px-2 py-2 text-sm outline-none dark:bg-neutral-800"
                />
              </div>
              <p className="mt-1 text-[11px] text-neutral-400">
                Letters, numbers and hyphens. Must be unique.
              </p>
            </Field>

            <Field label="Description">
              <textarea
                name="description"
                rows={3}
                defaultValue={restaurant.description ?? ""}
                maxLength={2000}
                placeholder="A short tagline shown on your public menu."
                className={inputClass + " resize-y"}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency" required>
                <select
                  name="currency"
                  defaultValue={restaurant.currency}
                  className={inputClass}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Default language" required>
                <select
                  name="default_locale"
                  value={defaultLocale}
                  onChange={(e) => setDefaultLocale(e.target.value)}
                  className={inputClass}
                >
                  {SUPPORTED_LOCALES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Languages offered">
              <ChipSelect
                options={SUPPORTED_LOCALES.map((l) => l.code)}
                value={locales}
                onChange={(next) => {
                  // Never allow removing the default locale.
                  const withDefault = next.includes(defaultLocale)
                    ? next
                    : [defaultLocale, ...next];
                  setLocales(withDefault);
                }}
              />
              {/* Serialize selected locales for the server action. */}
              {locales.map((code) => (
                <input key={code} type="hidden" name="locales" value={code} />
              ))}
              <p className="mt-1.5 text-[11px] text-neutral-400">
                Selected:{" "}
                {locales.map((c) => LOCALE_LABEL.get(c) ?? c).join(", ")}
              </p>
            </Field>
          </div>
        </Card>
      </form>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800";

function Card({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
      {footer && (
        <div className="flex items-center justify-end border-t border-neutral-100 px-5 py-3.5 dark:border-neutral-800">
          {footer}
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
