import { createHmac, createVerify, timingSafeEqual } from 'node:crypto';
import type { LicensePayload, SignedLicense } from '@shared/backend/contract';

// The license's signature check and the clock record's seal. Main process only.
//
// The backend signs each license with a private key that never leaves the
// Apps Script project (the LICENSE_PRIVATE_KEY Script Property). The app ships
// with the matching public key below, so it can check a license offline but
// never make one: a date edited on this computer breaks the signature.
//
// Replacing the key pair means a new public key here AND the new private key
// in the script; every license already handed out then fails the check until
// the app has fetched a fresh one online.

export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqPGv93zAX4asnnlUnYL2
NjSMcbIZx3MyC9IIKWgNu6lxlKHZg2ZZpE/+A9S7hsynmql85l9odJAkz+uNlJvd
xEgnqEsRcge4iR8M9PzxCOV0xa0luxhp/PCxB9fUWjMH65R5ZkMf9ZYd2RF/vOKC
BNYZASlyaZasPT9a/xPx2vxhpvk0LVPehpjUQz2ldL+eQvJKUGqXdB+2Zz1JFOee
GXkLp8/GJcfUjfAV1QZ6atMXu4U0G5W1A0Omf3oWXxo24UIvjoYtVpscUSewwqqC
4ZKn6eznKd6v3JqUtqIKx12w0vgEtj1SMrV/81YxseMeZT2Bd2nA3C73BE3+8/9v
fwIDAQAB
-----END PUBLIC KEY-----
`;

const TYPES = ['TRIAL', 'ANNUAL', 'LIFETIME'];

/** The license's contents when the signature is good and the shape is right; otherwise null. */
export function verifyLicense(
  signed: SignedLicense | null | undefined,
  publicKey: string,
): LicensePayload | null {
  if (!signed || typeof signed.payload !== 'string' || !signed.signature) return null;
  try {
    const ok = createVerify('RSA-SHA256')
      .update(signed.payload, 'utf8')
      .verify(publicKey, signed.signature, 'base64');
    if (!ok) return null;
    const p = JSON.parse(signed.payload) as LicensePayload;
    const valid =
      p?.v === 1 &&
      typeof p.userId === 'string' &&
      typeof p.deviceId === 'string' &&
      TYPES.includes(p.type) &&
      typeof p.issuedAt === 'string' &&
      (p.expiresAt === null || typeof p.expiresAt === 'string');
    return valid ? p : null;
  } catch {
    return null;
  }
}

/**
 * The last time seen, sealed with a secret kept OS-encrypted beside it, so it
 * cannot be edited to an earlier time in the database. Deleting it only falls
 * back to the server's time in the license.
 */
export function sealTime(secret: string, t: number): string {
  return JSON.stringify({ t, mac: createHmac('sha256', secret).update(String(t)).digest('base64') });
}

export function openSealedTime(secret: string, record: string | null): number | null {
  if (!record) return null;
  try {
    const { t, mac } = JSON.parse(record) as { t: number; mac: string };
    if (typeof t !== 'number' || typeof mac !== 'string') return null;
    const expected = createHmac('sha256', secret).update(String(t)).digest();
    const actual = Buffer.from(mac, 'base64');
    return expected.length === actual.length && timingSafeEqual(expected, actual) ? t : null;
  } catch {
    return null;
  }
}

/** Window time counted against one license (the one signed at `issuedAt`). */
export interface UsageCount {
  issuedAt: string;
  usedMs: number;
}

const usageMac = (secret: string, userId: string, c: UsageCount) =>
  createHmac('sha256', secret).update(`usage|${userId}|${c.issuedAt}|${c.usedMs}`).digest();

/**
 * The offline budget's count, sealed like the last time seen: lowering it in
 * the database breaks the seal, and a broken or missing count is a spent budget.
 */
export function sealUsage(secret: string, userId: string, c: UsageCount): string {
  return JSON.stringify({ ...c, mac: usageMac(secret, userId, c).toString('base64') });
}

export function openSealedUsage(secret: string, userId: string, record: string | null): UsageCount | null {
  if (!record) return null;
  try {
    const { issuedAt, usedMs, mac } = JSON.parse(record) as UsageCount & { mac: string };
    if (typeof issuedAt !== 'string' || typeof usedMs !== 'number' || typeof mac !== 'string') return null;
    const expected = usageMac(secret, userId, { issuedAt, usedMs });
    const actual = Buffer.from(mac, 'base64');
    return expected.length === actual.length && timingSafeEqual(expected, actual) ? { issuedAt, usedMs } : null;
  } catch {
    return null;
  }
}

/**
 * The shadow copy's contents (shadow.ts): the newest license time, its usage
 * count and the running total per pilot, and the last time seen.
 */
export interface ShadowState {
  lastSeen: number | null;
  users: Record<string, { issuedAt: string; usedMs: number; totalMs: number }>;
}

const shadowMac = (secret: string, body: string) =>
  createHmac('sha256', secret).update(`shadow|${body}`).digest();

export function sealShadow(secret: string, state: ShadowState): string {
  const body = JSON.stringify(state);
  return JSON.stringify({ body, mac: shadowMac(secret, body).toString('base64') });
}

/** The shadow's contents when its seal holds; null when missing, unreadable or edited. */
export function openSealedShadow(secret: string, record: string | null): ShadowState | null {
  if (!record) return null;
  try {
    const { body, mac } = JSON.parse(record) as { body: string; mac: string };
    if (typeof body !== 'string' || typeof mac !== 'string') return null;
    const expected = shadowMac(secret, body);
    const actual = Buffer.from(mac, 'base64');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const state = JSON.parse(body) as ShadowState;
    return state && typeof state.users === 'object' && state.users ? state : null;
  } catch {
    return null;
  }
}
