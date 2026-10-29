import type { LicensePayload, LicenseType } from './contract';

// Where a license stands, worked out on this computer with no internet.
//
// The license itself is the backend's signed copy (checked in the main process,
// src/main/backend/license.ts). This decides what it means right now: running,
// expired, or not to be trusted because the clock went backwards. The clock is
// never taken at its word alone: "now" is the latest of the system clock, the
// last time this app saw it, and the server's clock when it signed the license,
// so setting the date back can never give a license more days.
//
// A clock held still (set each time just past the last time seen) never goes
// back, so it is the license's offline budget that stops it: the window time
// counted since the license was signed, on the app's own timer, may not pass
// `offlineBudgetMs`. Online, every profile check brings a fresh budget.

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
  /** The offline budget is used up: the app closes until it checks in online. */
  | 'verify'
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
  /** Window time left before it must check in; null when the license has no limit. */
  offlineLeftMs: number | null;
}

export interface LicenseInputs {
  license: LicensePayload | null;
  /** The system clock. */
  now: number;
  /** The latest system time this app recorded, if it has one it trusts. */
  lastSeen: number | null;
  /** The threshold already shown for this expiry, if any. */
  notified: NoticeDay | null;
  /**
   * Window time counted since this license was signed. Null or absent when the
   * count kept for it is missing or does not check out: the budget counts as spent.
   */
  usedMs?: number | null;
}

const UNCHECKED: LicenseStatus = {
  state: 'unchecked',
  type: null,
  expiresAt: null,
  daysLeft: null,
  notice: null,
  offlineLeftMs: null,
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

/** Window time left of the license's offline budget; null when it has none. */
export function offlineLeft(license: LicensePayload, usedMs: number | null | undefined): number | null {
  const budget = license.offlineBudgetMs;
  if (typeof budget !== 'number' || !Number.isFinite(budget)) return null;
  if (typeof usedMs !== 'number' || !Number.isFinite(usedMs)) return 0;
  return Math.max(0, budget - usedMs);
}

export function evaluateLicense({ license, now, lastSeen, notified, usedMs }: LicenseInputs): LicenseStatus {
  if (!license) return UNCHECKED;
  const base = { type: license.type, expiresAt: license.expiresAt };
  // A lifetime license has no date to protect, so the clock does not matter to it.
  if (license.type === 'LIFETIME' || !license.expiresAt) {
    return { ...base, state: 'active', daysLeft: null, notice: null, offlineLeftMs: null };
  }
  const floor = trustedFloor(license, lastSeen);
  const expires = time(license.expiresAt);
  const effective = Math.max(now, floor);
  const daysLeft = Math.max(0, calendarDaysBetween(effective, expires));
  const offlineLeftMs = offlineLeft(license, usedMs);
  // Expired wins over a wrong clock: with both, the pilot is told only that.
  if (license.status === 'EXPIRED' || effective >= expires) {
    return { ...base, state: 'expired', daysLeft: 0, notice: null, offlineLeftMs };
  }
  if (now < floor - CLOCK_TOLERANCE_MS) return { ...base, state: 'clock', daysLeft, notice: null, offlineLeftMs };
  if (offlineLeftMs === 0) return { ...base, state: 'verify', daysLeft, notice: null, offlineLeftMs };
  const due = noticeFor(daysLeft);
  const notice = due !== null && (notified === null || due < notified) ? due : null;
  return { ...base, state: 'active', daysLeft, notice, offlineLeftMs };
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
