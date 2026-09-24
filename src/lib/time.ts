// Small relative-time helper for staff screens: "just now", "3 min", "2 h".

export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} d`;
}

// "14:05" in the restaurant's timezone.
export function clockTime(iso: string, timeZone: string, locale = "en-GB"): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

// Is this a timezone the runtime actually knows?
//
// NOT `Intl.supportedValuesOf("timeZone").includes(tz)`: that lists only
// *canonical* IANA names, and for India the canonical name is still the
// historical "Asia/Calcutta". The modern "Asia/Kolkata" is an alias, so the
// list check rejected the very zone the settings dropdown offers first.
//
// Constructing a formatter accepts canonical names and aliases alike, and
// throws a RangeError for anything that isn't a real zone — including
// near-miss typos like "Asia/Kolkatta".
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// The runtime's preferred spelling for a zone, so two names for the same place
// ("Asia/Kolkata" and "Asia/Calcutta") can be recognised as one.
export function canonicalTimezone(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: tz }).resolvedOptions()
      .timeZone;
  } catch {
    return tz;
  }
}

