import type { ApiErrorCode } from '@shared/backend/contract';

// The activation key field's rules, kept out of the component so they can be
// tested on their own.
//
// A key is PLUTO-SIM-XXXX-XXXX. The field shows the PLUTO-SIM- prefix fixed and
// the student types the 8 characters after it, from a card or a message, so it
// forgives case, spaces and dashes, and a paste of the whole key works.
//
// Keys are generated from ABCDEFGHJKMNPQRSTUVWXYZ23456789 (backend Setup.js):
// O, 0, I, 1 and L never occur, so there is no right way to "fix" one — O read
// as 0 is still a wrong key. They are kept, because a key the team typed into
// the sheet by hand may still contain one, and flagged so the student checks
// that character on the card.

export const KEY_PREFIX = 'PLUTO-SIM-';
export const KEY_LENGTH = 8;

/** Characters generated keys never contain. */
export const NEVER_IN_KEYS = ['O', '0', 'I', '1', 'L'] as const;

export interface KeyInput {
  /** Up to 8 characters, uppercase letters and digits only. */
  body: string;
  /** What the field shows after the prefix: "7KQ4-M2" (dash once past 4). */
  display: string;
  /** Symbols that were typed or pasted and taken out, each named once. */
  removed: string[];
  /** Characters no generated key contains, each named once, in typed order. */
  unusual: string[];
  /** More than 8 characters arrived; the rest were dropped. */
  overflow: boolean;
  complete: boolean;
}

/** Read what is in the field (or was pasted into it) as a key. */
export function parseKeyInput(raw: string): KeyInput {
  const upper = raw.toUpperCase();
  const removed: string[] = [];
  for (const ch of upper) {
    if (/[A-Z0-9\s-]/.test(ch)) continue;
    if (!removed.includes(ch)) removed.push(ch);
  }
  let compact = upper.replace(/[^A-Z0-9]/g, '');
  // A pasted or fully typed key: drop the prefix the field already shows. No
  // real key body starts with it (P, L, U, T, O, S, I, M: L, O and I never occur).
  if (compact.startsWith('PLUTOSIM')) compact = compact.slice(8);
  const body = compact.slice(0, KEY_LENGTH);
  const unusual: string[] = [];
  for (const ch of body) {
    if ((NEVER_IN_KEYS as readonly string[]).includes(ch) && !unusual.includes(ch)) unusual.push(ch);
  }
  return {
    body,
    display: body.length > 4 ? `${body.slice(0, 4)}-${body.slice(4)}` : body,
    removed,
    unusual,
    overflow: compact.length > KEY_LENGTH,
    complete: body.length === KEY_LENGTH,
  };
}

/** The whole key as the backend expects it. */
export function fullKey(body: string): string {
  return `${KEY_PREFIX}${body.slice(0, 4)}-${body.slice(4)}`;
}

/** "Or" list: "O", "O or 0", "O, 0 or 1". */
function orList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** The ▲ note under the key field, or null. Removed symbols first: they changed
 *  what the student typed. */
export function keyNote(input: KeyInput): string | null {
  if (input.removed.length > 0) {
    return `Removed ${input.removed.join(' ')}. Keys use only letters and numbers.`;
  }
  if (input.overflow) return `A key has ${KEY_LENGTH} characters after ${KEY_PREFIX}. The rest were left out.`;
  if (input.unusual.length > 0) {
    return `Keys never use O, 0, I, 1 or L. Check the ${orList(input.unusual)} on your card.`;
  }
  return null;
}

// ---- Where a failed activation or sign-in is reported ----------------------

/** A field error sits under its field and takes the focus; a banner sits above
 *  the button. Offline is caution, not failure: nothing is wrong with the key. */
export type ErrorPlace = 'key' | 'email' | 'banner' | 'offline';

export function errorPlace(code: ApiErrorCode): ErrorPlace {
  switch (code) {
    case 'KEY_NOT_FOUND':
    case 'KEY_ALREADY_USED':
    case 'KEY_DISABLED':
    case 'INVALID_CREDENTIALS':
      return 'key';
    case 'EMAIL_ALREADY_REGISTERED':
      return 'email';
    case 'NETWORK':
      return 'offline';
    default:
      return 'banner';
  }
}

/** Each message names the fix, not only the failure. Field errors are one
 *  line under the field; banners have a title and the fix under it. */
export const ERROR_TEXT: Partial<Record<ApiErrorCode, string>> = {
  KEY_NOT_FOUND:
    'This key was not found. Check each character against your key card, then press Activate again. Still failing? Ask whoever gave you the key.',
  KEY_ALREADY_USED: 'This key is linked to a different email. Use the email it was activated with.',
  KEY_DISABLED: 'This key has been switched off. Ask the PlutoSim team for a new one.',
  INVALID_CREDENTIALS:
    'This email and key do not match. Check both against the ones you activated with, then press Sign in again.',
  EMAIL_ALREADY_REGISTERED: 'This email already has a profile. Switch to Sign in above.',
  USER_INACTIVE: 'This profile has been switched off. Ask the PlutoSim team to turn it back on.',
  NETWORK:
    'PlutoSim needs to reach its server once. Connect to Wi-Fi or a hotspot, then press Try again. Everything you typed stays filled in.',
  SERVER_ERROR: 'PlutoSim had a problem on its side. Wait a minute, then press Try again.',
  NOT_CONFIGURED: 'Profiles are not set up in this build.',
};

/** The bold first line of a banner. */
export const BANNER_TITLE: Partial<Record<ApiErrorCode, string>> = {
  NETWORK: 'No internet connection',
  SERVER_ERROR: 'PlutoSim could not answer',
  USER_INACTIVE: 'This profile is switched off',
  DEVICE_MISMATCH: 'This profile is locked to another computer',
  NOT_CONFIGURED: 'Profiles are off',
};

// ---- Checks before sending -------------------------------------------------

export interface FormValues {
  mode: 'activate' | 'login';
  name: string;
  email: string;
  keyBody: string;
}

export type FieldName = 'name' | 'email' | 'key';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Problems in field order, so the first one is where focus goes. */
export function checkForm(v: FormValues): { field: FieldName; message: string }[] {
  const out: { field: FieldName; message: string }[] = [];
  if (v.mode === 'activate' && !v.name.trim()) out.push({ field: 'name', message: 'Enter your name, e.g. Asha Kulkarni.' });
  if (!v.email.trim()) out.push({ field: 'email', message: 'Enter your email, e.g. asha@school.edu.' });
  else if (!EMAIL_RE.test(v.email.trim())) out.push({ field: 'email', message: 'Add the full address, e.g. asha@school.edu.' });
  if (v.keyBody.length < KEY_LENGTH) {
    out.push({
      field: 'key',
      message: `Type all ${KEY_LENGTH} characters after ${KEY_PREFIX} (${v.keyBody.length} of ${KEY_LENGTH} so far).`,
    });
  }
  return out;
}

/** "Asha Rao" -> "AR", "asha" -> "A". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** "Asha Rao" -> "Asha". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
