// How an owner reaches a human. Set NEXT_PUBLIC_SUPPORT_EMAIL (and optionally
// NEXT_PUBLIC_SUPPORT_WHATSAPP, digits only with country code) in the
// environment. Nothing is invented when they are unset: the upgrade page says
// to get in touch without printing an address that would bounce.

export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "";
export const SUPPORT_WHATSAPP = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "";

export function hasSupportContact(): boolean {
  return SUPPORT_EMAIL !== "" || SUPPORT_WHATSAPP !== "";
}

// A mailto the owner does not have to fill in: which restaurant, and what for.
export function upgradeMailto(restaurantName: string, slug: string): string | null {
  if (!SUPPORT_EMAIL) return null;
  const subject = `Upgrade to Pro — ${restaurantName}`;
  const body = [
    `I'd like to upgrade ${restaurantName} (/m/${slug}) to the Pro plan.`,
    "",
    "Restaurant: " + restaurantName,
    "Menu link: /m/" + slug,
  ].join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function upgradeWhatsapp(restaurantName: string): string | null {
  if (!SUPPORT_WHATSAPP) return null;
  const text = `Hi — I'd like to upgrade ${restaurantName} to the fast_menu Pro plan.`;
  return `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`;
}
