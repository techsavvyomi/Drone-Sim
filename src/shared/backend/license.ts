import type { LicensePayload, LicenseType } from './contract';

// Where a license stands, worked out on this computer with no internet.
//
// The license itself is the backend's signed copy (checked in the main process,
// src/main/backend/license.ts). This decides what it means right now: running,
// expired, or not to be trusted because the clock went backwards. The clock is
// never taken at its word alone: "now" is the latest of the system clock, the
// last time this app saw it, and the server's clock when it signed the license,
// so setting the date back can never give a license more days.

/** How far the clock may sit behind the last time seen before it counts as moved back. */
export const CLOCK_TOLERANCE_MS = 60 * 60 * 1000;

/** Days before expiry that bring a warning, each once (the brief's schedule). */
export const NOTICE_DAYS = [30, 7, 3, 1, 0] as const;
export type NoticeDay = (typeof NOTICE_DAYS)[number];

export type LicenseState =
  /** Running: fly. */
  | 'active'
  /** Past its expiry: the app closes until the key is renewed. */
  | 'expired'
  /** The clock is behind the last time seen: the app closes until it is put right. */
  | 'clock'
  /** No license this computer can trust yet: checked online once to open. */
  | 'unchecked';

export interface LicenseStatus {
  state: LicenseState;
  type: LicenseType | null;
  expiresAt: string | null;
  /** Calendar days left on this computer's calendar; 0 on the expiry day. Null for lifetime. */
  daysLeft: number | null;
  /** The warning still to show: the closest threshold reached and not seen yet. */
  notice: NoticeDay | null;
}

export interface LicenseInputs {
  license: LicensePayload | null;
  /** The system clock. */
  now: number;
  /** The latest system time this app recorded, if it has one it trusts. */
  lastSeen: number | null;
  /** The threshold already shown for this expiry, if any. */
  notified: NoticeDay | null;
}

const UNCHECKED: LicenseStatus = {
  state: 'unchecked',
  type: null,
  expiresAt: null,
  daysLeft: null,
  notice: null,
};

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Midnight-to-midnight days from `from` to `to` on this computer's calendar. */
export function calendarDaysBetween(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  const dayA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const dayB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((dayB - dayA) / 86_400_000);
}

/** The closest warning threshold `daysLeft` has reached, or null more than 30 days out. */
export function noticeFor(daysLeft: number): NoticeDay | null {
  for (const day of [...NOTICE_DAYS].reverse()) if (daysLeft <= day) return day;
  return null;
}

/** The latest time the app can vouch for: the clock may not go behind it. */
export function trustedFloor(license: LicensePayload | null, lastSeen: number | null): number {
  return Math.max(lastSeen ?? 0, time(license?.issuedAt));
}

export function evaluateLicense({ license, now, lastSeen, notified }: LicenseInputs): LicenseStatus {
  if (!license) return UNCHECKED;
  const base = { type: license.type, expiresAt: license.expiresAt };
  // A lifetime license has no date to protect, so the clock does not matter to it.
  if (license.type === 'LIFETIME' || !license.expiresAt) {
    return { ...base, state: 'active', daysLeft: null, notice: null };
  }
  const floor = trustedFloor(license, lastSeen);
  const expires = time(license.expiresAt);
  const effective = Math.max(now, floor);
  const daysLeft = Math.max(0, calendarDaysBetween(effective, expires));
  if (now < floor - CLOCK_TOLERANCE_MS) return { ...base, state: 'clock', daysLeft, notice: null };
  if (license.status === 'EXPIRED' || effective >= expires) {
    return { ...base, state: 'expired', daysLeft: 0, notice: null };
  }
  const due = noticeFor(daysLeft);
  const notice = due !== null && (notified === null || due < notified) ? due : null;
  return { ...base, state: 'active', daysLeft, notice };
}

/** The pop-up's words for a warning (the brief's examples). */
export function noticeText(daysLeft: number): { title: string; text: string } {
  if (daysLeft <= 0) {
    return {
      title: 'License Expires Today',
      text: 'Your license expires today. Please renew your license.',
    };
  }
  if (daysLeft === 1) {
    return {
      title: 'License Expiring Tomorrow',
      text: 'Your license will expire tomorrow. Please renew your license.',
    };
  }
  return {
    title: 'License Expiring Soon',
    text: `Your license will expire in ${daysLeft} days. Please renew your license.`,
  };
}
