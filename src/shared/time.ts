// All business rules run on India Standard Time (UTC+05:30, no daylight saving).
// We do the offset arithmetic ourselves so the result never depends on the
// server's or the phone's timezone setting.

export const IST_OFFSET_MINUTES = 330;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Contact window allowed by the RBI recovery guidelines: 08:00 to 19:00 IST. */
export const CONTACT_START_HOUR = 8;
export const CONTACT_END_HOUR = 19;

function toIstWallClock(date: Date): Date {
  // A Date whose UTC fields equal the IST wall-clock fields.
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
}

/** Minutes since IST midnight, 0..1439. */
export function istMinutesOfDay(date: Date): number {
  const w = toIstWallClock(date);
  return w.getUTCHours() * 60 + w.getUTCMinutes();
}

/** Calendar date in IST as YYYY-MM-DD. */
export function istDate(date: Date): string {
  return toIstWallClock(date).toISOString().slice(0, 10);
}

/** First day of the IST month as YYYY-MM. */
export function istMonth(date: Date): string {
  return istDate(date).slice(0, 7);
}

/** Add whole days to a YYYY-MM-DD string. */
export function addDays(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a), both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** The instant of a given IST wall-clock time on a given IST date. */
export function istInstant(ymd: string, hour: number, minute = 0): Date {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + (hour * 60 + minute - IST_OFFSET_MINUTES) * 60 * 1000);
}

export type ContactWindowState =
  | { open: true; closesAt: Date; minutesLeft: number }
  | { open: false; opensAt: Date; reason: 'before_window' | 'after_window' };

/**
 * Is borrower contact allowed at this instant?
 * Window is [08:00, 19:00) IST: 07:59 is blocked, 08:00 is allowed,
 * 18:59 is allowed, 19:00 is blocked.
 */
export function contactWindow(now: Date): ContactWindowState {
  const minutes = istMinutesOfDay(now);
  const start = CONTACT_START_HOUR * 60;
  const end = CONTACT_END_HOUR * 60;
  const today = istDate(now);
  if (minutes < start) {
    return { open: false, opensAt: istInstant(today, CONTACT_START_HOUR), reason: 'before_window' };
  }
  if (minutes >= end) {
    return { open: false, opensAt: istInstant(addDays(today, 1), CONTACT_START_HOUR), reason: 'after_window' };
  }
  return { open: true, closesAt: istInstant(today, CONTACT_END_HOUR), minutesLeft: end - minutes };
}

export function isContactAllowed(at: Date): boolean {
  return contactWindow(at).open;
}

/** "8:00 AM" style label in IST. */
export function istTimeLabel(date: Date): string {
  const m = istMinutesOfDay(date);
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}
